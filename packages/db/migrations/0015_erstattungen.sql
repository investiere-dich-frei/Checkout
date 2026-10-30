-- 0015 Erstattungen mit Stornorechnung.
--
-- Eine Erstattung bezieht sich auf genau eine Rechnung und erstattet sie voll.
-- Sie wird zuerst als „angefordert“ festgehalten, dann beim Zahlungsanbieter
-- ausgelöst. Erst wenn der Anbieter bestätigt, entstehen Stornorechnung und
-- Erstattungsbuchung. Scheitert der Anbieter, bleibt die Rechnung unverändert.

create table app.refunds (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references app.invoices (id),
  payment_id         uuid not null references app.payments (id),
  provider           text not null check (provider in ('stripe', 'paypal', 'ueberweisung')),
  amount_cents       bigint not null check (amount_cents > 0),
  currency           char(3) not null,
  reason             text not null check (length(trim(reason)) > 0),
  requested_by       uuid not null references app.users (id),
  status             text not null default 'angefordert' check (status in ('angefordert', 'erstattet', 'fehlgeschlagen')),
  provider_refund_id text,
  error_code         text,
  storno_invoice_id  uuid references app.invoices (id),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  check ((status = 'erstattet') = (storno_invoice_id is not null and provider_refund_id is not null and completed_at is not null))
);
-- Je Rechnung höchstens eine laufende oder erfolgreiche Erstattung.
create unique index refunds_one_per_invoice_idx on app.refunds (invoice_id) where status <> 'fehlgeschlagen';

-- Nur der Ausgang einer angeforderten Erstattung wird einmal eingetragen.
create or replace function app.refunds_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'angefordert'
     or (to_jsonb(new) - 'status' - 'provider_refund_id' - 'error_code' - 'storno_invoice_id' - 'completed_at')
        is distinct from (to_jsonb(old) - 'status' - 'provider_refund_id' - 'error_code' - 'storno_invoice_id' - 'completed_at') then
    raise exception 'GoBD: Erstattung % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger refunds_guard
  before update on app.refunds
  for each row execute function app.refunds_guard();
create trigger refunds_no_delete
  before delete on app.refunds
  for each row execute function app.forbid_change();
create trigger refunds_no_truncate
  before truncate on app.refunds
  for each statement execute function app.forbid_change();
create trigger refunds_audit
  after insert or update on app.refunds
  for each row execute function app.audit_row();
