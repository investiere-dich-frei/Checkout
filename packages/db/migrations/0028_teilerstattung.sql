-- 0028 Teilerstattung mit Rechnungskorrektur.
--
--  * Eine Rechnung kann jetzt voll (Stornorechnung wie bisher) oder in Teilen erstattet werden.
--    Jede Teilerstattung erzeugt eine Rechnungskorrektur (kind 'korrektur') mit negativem
--    Betrag; die Spalte refunds.storno_invoice_id zeigt dann auf diese Korrektur.
--  * Zusammen dürfen Erstattungen nie mehr als den Rechnungsbetrag ausmachen. Eine volle
--    Erstattung geht nur, solange noch nichts erstattet ist.
--  * Je Rechnung läuft höchstens eine Erstattung gleichzeitig (Status angefordert).
--  * Korrekturen und Storno zu einer Rechnung dürfen zusammen höchstens ihren Betrag umkehren.
--  * Neue Meldung zahlung.teilerstattet für n8n: Teilerstattung ohne Ende des Zugangs.

alter table app.refunds add column scope text not null default 'voll' check (scope in ('voll', 'teil'));

drop index app.refunds_one_per_invoice_idx;
create unique index refunds_one_open_per_invoice_idx on app.refunds (invoice_id) where status = 'angefordert';

create or replace function app.refunds_limit() returns trigger
language plpgsql as $$
declare
  v_gross bigint;
  v_used  bigint;
begin
  -- Sperrt die Rechnung, damit zwei Erstattungen nicht gleichzeitig durchrutschen.
  select gross_cents into v_gross from app.invoices where id = new.invoice_id for update;
  select coalesce(sum(amount_cents), 0) into v_used
    from app.refunds where invoice_id = new.invoice_id and status <> 'fehlgeschlagen';
  if v_used + new.amount_cents > v_gross then
    raise exception 'GoBD: Erstattungen übersteigen den Betrag der Rechnung' using errcode = 'P0001';
  end if;
  if new.scope = 'voll' and (v_used > 0 or new.amount_cents <> v_gross) then
    raise exception 'GoBD: Volle Erstattung nur über den ganzen, noch nicht erstatteten Betrag' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger refunds_limit
  before insert on app.refunds
  for each row execute function app.refunds_limit();

create or replace function app.invoices_correction_limit() returns trigger
language plpgsql as $$
declare
  v_orig bigint;
  v_sum  bigint;
begin
  if new.corrects_invoice_id is null or new.gross_cents >= 0 then
    return new;
  end if;
  select gross_cents into v_orig from app.invoices where id = new.corrects_invoice_id for update;
  select coalesce(sum(gross_cents), 0) into v_sum
    from app.invoices where corrects_invoice_id = new.corrects_invoice_id and gross_cents < 0;
  if v_sum + new.gross_cents < -v_orig then
    raise exception 'GoBD: Korrekturen und Storno übersteigen den Betrag der Rechnung' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger invoices_correction_limit
  before insert on app.invoices
  for each row execute function app.invoices_correction_limit();

alter table app.webhook_outbox drop constraint webhook_outbox_event_type_check;
alter table app.webhook_outbox add constraint webhook_outbox_event_type_check check (event_type in (
  'zahlung.eingegangen', 'zahlung.erstattet', 'zahlung.teilerstattet', 'abo.beendet', 'bestellung.beendet',
  'abo.pausiert', 'abo.fortgesetzt'));
