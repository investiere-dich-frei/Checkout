-- 0023 Manuelle Bestellungen: Rechnung zuerst, Zahlung per Überweisung.
--
-- Bisher lief das über n8n („IDF Manuelle Bestellung – Formular/Verarbeitung/Storno“).
-- Die Vertriebsperson erfasst Kundin, Produkt und den vereinbarten Betrag mit
-- Zahlungsplan. Die Rechnung über den Gesamtbetrag entsteht sofort im lückenlosen
-- Kreis IDF-n und geht mit Bankverbindung an die Kundin. Zahlungseingänge werden von
-- Hand je Fälligkeit verbucht. Ein Storno erzeugt immer eine Stornorechnung über den
-- vollen Betrag; Gezahltes wird per Überweisung zurückgezahlt und als Rückzahlung
-- verbucht. Gelöscht wird nichts.

-- Bankverbindung der Gesellschaft für Rechnungen mit Überweisung. Landet über den
-- Schnappschuss der Gesellschaft unverändert in jeder Rechnung.
alter table app.companies
  add column bank_name text,
  add column iban      text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  add column bic       text check (bic is null or bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$');

select set_config('app.actor', 'system:migration-0023', true);

-- Bankverbindung wie bisher auf den Überweisungsrechnungen aus n8n.
update app.companies set bank_name = 'Hannoversche Volksbank', iban = 'DE96251900010438090800'
 where legal_name = 'Investiere Dich Frei GmbH' and iban is null;

-- Je Produkt eine verdeckte Preisoption für Bestellungen mit vereinbartem Betrag.
-- Sie ist nie im Shop zu kaufen; Betrag und Zahlplan stehen in der Bestellung selbst.
alter table app.price_options
  add column manual_only boolean not null default false;
alter table app.price_options
  add constraint price_options_manual_never_active check (not (manual_only and active));
create unique index price_options_manual_per_product on app.price_options (product_id) where manual_only;

create table app.manual_orders (
  order_id          uuid primary key references app.orders (id),
  -- Rechnung über den Gesamtbetrag, ausgestellt beim Anlegen.
  invoice_id        uuid not null unique references app.invoices (id),
  payment_model     text not null check (payment_model in ('einmal', 'anzahlung_rest', 'anzahlung_raten', 'raten')),
  payment_term_days integer not null check (payment_term_days between 0 and 90),
  -- Zahlungsziel der ersten Zahlung. Spätere Raten sind nie früher fällig.
  pay_by            date not null,
  created_by        uuid not null references app.users (id),
  internal_note     text,
  created_at        timestamptz not null default now(),
  -- Storno: einmal gesetzt, danach fest.
  cancelled_at      timestamptz,
  cancelled_by      uuid references app.users (id),
  cancel_reason     text check (cancel_reason is null or length(trim(cancel_reason)) > 0),
  storno_invoice_id uuid unique references app.invoices (id),
  -- Beim Storno bereits gezahlt und deshalb zurückzuzahlen.
  refund_due_cents  bigint check (refund_due_cents is null or refund_due_cents >= 0),
  -- Rückzahlung erledigt: einmal gesetzt, danach fest.
  refunded_at       timestamptz,
  refunded_by       uuid references app.users (id),
  refund_reference  text,
  check ((cancelled_at is null) = (cancelled_by is null)),
  check ((cancelled_at is null) = (cancel_reason is null)),
  check ((cancelled_at is null) = (storno_invoice_id is null)),
  check ((cancelled_at is null) = (refund_due_cents is null)),
  check ((refunded_at is null) = (refunded_by is null)),
  check (refunded_at is null or refund_due_cents > 0)
);
create index manual_orders_open_idx on app.manual_orders (pay_by) where cancelled_at is null;

-- Nur Storno und danach Rückzahlung dürfen nachgetragen werden, jeweils genau einmal.
create or replace function app.manual_orders_guard() returns trigger
language plpgsql as $$
declare
  cancel_fields constant text[] := array['cancelled_at', 'cancelled_by', 'cancel_reason', 'storno_invoice_id', 'refund_due_cents'];
  refund_fields constant text[] := array['refunded_at', 'refunded_by', 'refund_reference'];
begin
  if (to_jsonb(new) - cancel_fields - refund_fields) is distinct from (to_jsonb(old) - cancel_fields - refund_fields) then
    raise exception 'GoBD: manuelle Bestellung % ist festgeschrieben', old.order_id using errcode = 'P0001';
  end if;
  if old.cancelled_at is not null
     and (to_jsonb(new) - refund_fields) is distinct from (to_jsonb(old) - refund_fields) then
    raise exception 'GoBD: Storno der Bestellung % ist festgeschrieben', old.order_id using errcode = 'P0001';
  end if;
  if old.refunded_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'GoBD: Rückzahlung der Bestellung % ist festgeschrieben', old.order_id using errcode = 'P0001';
  end if;
  if new.refunded_at is not null and new.cancelled_at is null then
    raise exception 'Rückzahlung nur nach Storno' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger manual_orders_guard
  before update on app.manual_orders
  for each row execute function app.manual_orders_guard();

-- Verlauf für die Verwaltung: wer hat wann angelegt, Zahlung verbucht, storniert,
-- zurückgezahlt. Unveränderbar.
create table app.manual_order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references app.manual_orders (order_id),
  kind       text not null check (kind in ('angelegt', 'zahlung', 'storno', 'rueckzahlung')),
  user_id    uuid not null references app.users (id),
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index manual_order_events_order_idx on app.manual_order_events (order_id, created_at);

create trigger manual_order_events_immutable
  before update or delete on app.manual_order_events
  for each row execute function app.forbid_change();

do $$
declare
  t text;
begin
  foreach t in array array['manual_orders', 'manual_order_events'] loop
    execute format(
      'create trigger %I before truncate on app.%I for each statement execute function app.forbid_change()',
      t || '_no_truncate', t);
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;

create trigger manual_orders_no_delete
  before delete on app.manual_orders
  for each row execute function app.forbid_change();
