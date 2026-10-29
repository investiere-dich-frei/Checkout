-- 0005 Bestellungen mit Steuerentscheidung und Zahlplan.
--
--  * Jede Bestellposition hält Netto, Steuer, Brutto, Satz, Hinweistext und die
--    angewendete Steuerregel fest. Spätere Regeländerungen berühren sie nicht.
--  * Der Zahlplan einer Bestellung (alle Fälligkeiten) entsteht mit der Bestellung
--    und wird danach nicht mehr geändert, nur im Status fortgeschrieben.

-- Schweizer MWST-Satz, falls die Gesellschaft in der Schweiz registriert ist.
alter table app.companies
  add column ch_vat_rate_bp integer check (ch_vat_rate_bp is null or ch_vat_rate_bp between 1 and 10000);

-- Herkunft der Bestellung, für den Verkäufernachweis und spätere Auswertungen.
alter table app.orders
  add column buyer_country char(2),
  add column buyer_is_business boolean not null default false;

alter table app.order_items
  add column net_cents         bigint,
  add column tax_cents         bigint,
  add column gross_cents       bigint,
  add column tax_rate_bp       integer check (tax_rate_bp is null or tax_rate_bp between 0 and 10000),
  add column tax_note          text,
  add column tax_rule          text,
  add column tax_rules_version text;

alter table app.order_items
  add constraint order_items_tax_complete check (
    tax_rule is null
    or (net_cents is not null and tax_cents is not null and gross_cents is not null and tax_rate_bp is not null
        and tax_rules_version is not null
        and net_cents + tax_cents = gross_cents
        and (tax_rate_bp > 0 or tax_note is not null))
  ) not valid;

create or replace function app.order_items_tax_immutable() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'id') is distinct from (to_jsonb(old) - 'id') then
    raise exception 'GoBD: Bestellposition % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_items_immutable
  before update on app.order_items
  for each row execute function app.order_items_tax_immutable();

-- Eine Zeile je Fälligkeit. Beträge brutto in der Währung der Bestellung.
create table app.order_installments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references app.orders (id),
  order_item_id uuid not null references app.order_items (id),
  seq           integer not null check (seq > 0),
  due_date      date not null,
  net_cents     bigint not null check (net_cents >= 0),
  tax_cents     bigint not null check (tax_cents >= 0),
  gross_cents   bigint not null check (gross_cents >= 0),
  status        text not null default 'offen' check (status in ('offen', 'bezahlt', 'fehlgeschlagen', 'erlassen', 'storniert')),
  payment_id    uuid references app.payments (id),
  invoice_id    uuid references app.invoices (id),
  created_at    timestamptz not null default now(),
  unique (order_item_id, seq),
  check (net_cents + tax_cents = gross_cents),
  check (status <> 'bezahlt' or payment_id is not null),
  check (invoice_id is null or payment_id is not null)
);
create unique index order_installments_invoice_idx on app.order_installments (invoice_id) where invoice_id is not null;
create index order_installments_due_idx on app.order_installments (due_date) where status = 'offen';

-- Nur Status, Zahlung und Rechnung dürfen sich ändern; Betrag und Fälligkeit nie.
-- Zahlung und Rechnung werden einmal gesetzt und dann nicht mehr umgehängt.
create or replace function app.order_installments_guard() returns trigger
language plpgsql as $$
begin
  if (old.payment_id is not null and new.payment_id is distinct from old.payment_id)
     or (old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id) then
    raise exception 'GoBD: Zahlung und Rechnung der Fälligkeit % sind bereits zugeordnet', old.seq
      using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'status' - 'payment_id' - 'invoice_id')
     is distinct from (to_jsonb(old) - 'status' - 'payment_id' - 'invoice_id') then
    raise exception 'GoBD: Fälligkeit % der Bestellung % ist festgeschrieben', old.seq, old.order_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_installments_guard
  before update on app.order_installments
  for each row execute function app.order_installments_guard();

create trigger order_installments_no_delete
  before delete on app.order_installments
  for each row execute function app.forbid_change();

create trigger order_installments_no_truncate
  before truncate on app.order_installments
  for each statement execute function app.forbid_change();

create trigger order_installments_audit
  after insert or update or delete on app.order_installments
  for each row execute function app.audit_row();
