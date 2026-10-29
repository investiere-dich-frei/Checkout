-- 0003 Audit-Trail: nur anhängend, mit Hash-Kette.
-- Jede Zeile enthält den Hash der vorigen Zeile. Wer eine Zeile nachträglich
-- ändert oder löscht (z. B. als Superuser mit abgeschalteten Triggern),
-- bricht die Kette; app.audit_verify() findet die Stelle.
--
-- Wer handelt, setzt die Anwendung pro Transaktion:
--   set local app.actor = 'user:<uuid>'   bzw. 'system:<job>'

create table app.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor       text not null,
  table_name  text not null,
  record_id   text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  txid        xid8 not null default pg_current_xact_id(),
  prev_hash   bytea not null,
  hash        bytea not null
);
create index audit_log_record_idx on app.audit_log (table_name, record_id);

create or replace function app.audit_hash(
  p_prev bytea, p_id bigint, p_occurred_at timestamptz, p_actor text, p_table text,
  p_record text, p_action text, p_old jsonb, p_new jsonb
) returns bytea
language sql immutable as $$
  select sha256(
    p_prev
    || convert_to(
         concat_ws(chr(31),
           p_id::text,
           -- Mikrosekunden seit 1970, unabhängig von der Zeitzone der Sitzung.
           (extract(epoch from p_occurred_at) * 1000000)::bigint::text,
           p_actor, p_table, p_record, p_action,
           coalesce(p_old::text, ''), coalesce(p_new::text, '')),
         'UTF8')
  );
$$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = app, pg_catalog as $$
declare
  v_prev   bytea;
  v_id     bigint;
  v_at     timestamptz := clock_timestamp();
  v_actor  text := coalesce(nullif(current_setting('app.actor', true), ''), 'db:' || session_user);
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_record text := coalesce(v_new, v_old) ->> 'id';
begin
  -- Eine Kette, eine Reihenfolge: Schreibzugriffe auf das Log werden serialisiert.
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

create trigger audit_log_immutable
  before update or delete on app.audit_log
  for each row execute function app.forbid_change();

create trigger audit_log_no_truncate
  before truncate on app.audit_log
  for each statement execute function app.forbid_change();

-- Prüft die gesamte Kette. Gibt die erste fehlerhafte Zeile zurück, sonst nichts.
create or replace function app.audit_verify()
returns table (broken_id bigint, reason text)
language plpgsql stable as $$
declare
  r      app.audit_log;
  v_prev bytea := '\x00'::bytea;
begin
  for r in select * from app.audit_log order by id loop
    if r.prev_hash <> v_prev then
      broken_id := r.id; reason := 'Verweis auf vorige Zeile stimmt nicht (Zeile entfernt oder geändert)';
      return next; return;
    end if;
    if r.hash <> app.audit_hash(r.prev_hash, r.id, r.occurred_at, r.actor, r.table_name,
                                r.record_id, r.action, r.old_data, r.new_data) then
      broken_id := r.id; reason := 'Inhalt der Zeile wurde verändert';
      return next; return;
    end if;
    v_prev := r.hash;
  end loop;
end;
$$;

-- Kopf der Kette. Wird täglich in den WORM-Speicher geschrieben, damit auch
-- das Abschneiden der letzten Zeilen auffällt.
create or replace function app.audit_head(out last_id bigint, out last_hash bytea)
language sql stable as $$
  select id, hash from app.audit_log order by id desc limit 1;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'users', 'customers', 'products', 'price_options', 'legal_text_versions',
    'orders', 'order_items', 'payments', 'invoice_number_series', 'invoices', 'invoice_items'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;
