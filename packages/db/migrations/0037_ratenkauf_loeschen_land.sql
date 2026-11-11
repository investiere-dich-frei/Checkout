-- 0037 Ratenkauf: Fragebogen-Antworten löschen, Länder für Ratenkredit.
--
-- Entscheidung Christian vom 11.11.2026 (Gegenprüfung CCD2):
--  1. Die Antworten aus dem Fragebogen (Einkommen, Wohnkosten, Zahlungsprobleme) und die Kundenangaben
--     einer Prüfung werden nach Ablauf der Aufbewahrung geschwärzt (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO).
--     Ergebnis, Regeln, Beträge und Begründungen bleiben als Nachweis der Prüfung (§ 505b Abs. 4 BGB n. F.).
--     Prüfungen sind keine Buchungsbelege; Rechnungen, Bestellungen und Ratenverträge bleiben unverändert.
--     Erlaubt ist nur dieser eine Übergang (redacted_at von leer auf gesetzt, Felder geleert); alles andere
--     bleibt gesperrt, Löschen der Zeile ebenso.
--  2. Das Audit-Log der Prüfungen speichert Antworten und Kundenangaben nicht mehr im Klartext, sonst lägen
--     sie dort unlöschbar.
--  3. Ratenkredit nur für Anschriften in den eingestellten Ländern (zunächst nur DE).

select set_config('app.actor', 'system:migration-0037', true);

alter table app.credit_checks add column redacted_at timestamptz;

create or replace function app.credit_checks_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.redacted_at is null and new.redacted_at is not null
     and new.answers = '{}'::jsonb and new.customer = '{}'::jsonb and new.email = 'geschwärzt'
     and new.free_income_cents is null and new.bureau_response is null
     and (to_jsonb(new) - array['redacted_at', 'answers', 'customer', 'email', 'free_income_cents', 'bureau_response'])
       = (to_jsonb(old) - array['redacted_at', 'answers', 'customer', 'email', 'free_income_cents', 'bureau_response'])
  then
    return new;
  end if;
  raise exception 'GoBD: % auf %.% ist nicht erlaubt (nur Schwärzen nach Ablauf der Aufbewahrung)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

drop trigger credit_checks_immutable on app.credit_checks;
create trigger credit_checks_immutable before update or delete on app.credit_checks
  for each row execute function app.credit_checks_guard();

-- Audit ohne Antworten und Kundenangaben: gleiche Kette wie app.audit_row, nur mit gekürzten Daten.
create or replace function app.audit_row_credit_check() returns trigger
language plpgsql security definer set search_path = app, pg_catalog as $$
declare
  v_prev   bytea;
  v_id     bigint;
  v_at     timestamptz := clock_timestamp();
  v_actor  text := coalesce(nullif(current_setting('app.actor', true), ''), 'db:' || session_user);
  v_hidden text[] := array['answers', 'customer', 'email', 'free_income_cents', 'bureau_response'];
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - v_hidden end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - v_hidden end;
  v_record text := coalesce(v_new, v_old) ->> 'id';
begin
  perform pg_advisory_xact_lock(hashtext('app.audit_log'));
  select hash into v_prev from app.audit_log order by id desc limit 1;
  v_prev := coalesce(v_prev, '\x00'::bytea);
  v_id := nextval(pg_get_serial_sequence('app.audit_log', 'id'));
  insert into app.audit_log (id, occurred_at, actor, table_name, record_id, action, old_data, new_data, prev_hash, hash)
  overriding system value
  values (v_id, v_at, v_actor, tg_table_name, coalesce(v_record, ''), tg_op, v_old, v_new, v_prev,
          app.audit_hash(v_prev, v_id, v_at, v_actor, tg_table_name, coalesce(v_record, ''), tg_op, v_old, v_new));
  return null;
end;
$$;

drop trigger credit_checks_audit on app.credit_checks;
create trigger credit_checks_audit after insert or update or delete on app.credit_checks
  for each row execute function app.audit_row_credit_check();

alter table app.credit_settings
  add column credit_countries text[] not null default '{DE}'
    check (cardinality(credit_countries) between 1 and 10 and array_to_string(credit_countries, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$');
