-- 0006 Altdaten aus Thrivecart: Kunden, Käufe, Zahlungsereignisse, Abos und Rechnungen.
--
--  * Altdaten liegen in eigenen Tabellen (Schema legacy). Sie werden nicht in die neuen
--    Bestellungen und Rechnungen umgeschrieben: Die Belege sind in Thrivecart entstanden
--    und bleiben so erhalten, wie sie dort ausgestellt wurden.
--  * Zahlungsereignisse und Rechnungen sind nach dem Import unveränderbar. Käufe dürfen
--    nur ihren Status fortschreiben (z. B. erstattet), Abos ihren Stand, solange Thrivecart
--    parallel weiterläuft. Jede Änderung steht mit altem Wert im Audit-Log.
--  * Jede Zeile trägt die Thrivecart-ID und die vollständige Quellzeile (source_row),
--    damit nichts verloren geht, was das Modell nicht abbildet.
--  * Alte Rechnungen behalten ihre Nummern. Der neue Kreis (IDF-1 …) ist davon getrennt.

create schema if not exists legacy;

-- Kunden der neuen Welt bekommen ihre Herkunft und die Verweise auf Stripe und HubSpot.
alter table app.customers
  add column source             text,
  add column source_ref         text,
  add column stripe_customer_id text,
  add column hubspot_contact_id text,
  add constraint customers_source_unique unique (source, source_ref),
  add constraint customers_source_complete check ((source is null) = (source_ref is null));

-- Rechnungen aus Thrivecart. Eine Zeile je Rechnungsnummer. Thrivecart vergibt eine
-- Nummer je Kauf: Einmalkäufe (thrivecart_orders) und Abos/Raten (thrivecart_subscriptions)
-- teilen sich denselben Kreis; Folgezahlungen bekommen keine eigene Nummer.
-- In seltenen Fällen gehören zwei Käufe zu einer Rechnung (z. B. Produkt und Zusatzangebot). Das PDF wird nachgetragen,
-- sobald es aus Thrivecart geholt und im WORM-Speicher abgelegt ist.
-- Hinweis für die Schutz-Trigger: In BEFORE-Triggern ist die berechnete Spalte id noch
-- leer und wird deshalb beim Vergleich ausgelassen.
create table legacy.thrivecart_invoices (
  invoice_number  bigint primary key,
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet.
  id text generated always as (invoice_number::text) stored,
  -- Ausstellende Gesellschaft laut Datum (bis 22.09.2025 ECB Holding GmbH, ab 23.09.2025
  -- Investiere Dich Frei GmbH). Abgeleitet, nicht aus dem Beleg gelesen.
  issuer_name     text not null,
  issued_at       timestamptz not null,
  currency        char(3) not null,
  -- Bei Abos ist der Betrag der ersten Zahlung im Spiegel nicht immer bekannt.
  gross_cents     bigint,
  net_cents       bigint,
  tax_cents       bigint,
  -- Aus welcher Quelle die Rechnung stammt: kauf oder abo.
  source_kind     text not null check (source_kind in ('kauf', 'abo')),
  pdf_sha256      bytea,
  pdf_storage_key text,
  imported_at     timestamptz not null default now(),
  check ((pdf_sha256 is null) = (pdf_storage_key is null))
);

create table legacy.thrivecart_orders (
  order_id              bigint primary key,
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet.
  id text generated always as (order_id::text) stored,
  invoice_number        bigint not null references legacy.thrivecart_invoices (invoice_number),
  customer_id           uuid references app.customers (id),
  email                 text not null,
  ordered_at            timestamptz not null,
  thrivecart_product_id bigint,
  product_id            uuid references app.products (id),
  item_name             text,
  pricing_option_id     text,
  pricing_option_name   text,
  processor             text,
  currency              char(3) not null,
  gross_cents           bigint not null,
  net_cents             bigint,
  status                text not null,
  transaction_id        text,
  source_row            jsonb not null,
  imported_at           timestamptz not null default now()
);
create index thrivecart_orders_invoice_idx on legacy.thrivecart_orders (invoice_number);
create index thrivecart_orders_customer_idx on legacy.thrivecart_orders (customer_id);
create index thrivecart_orders_email_idx on legacy.thrivecart_orders (lower(email));

-- Zahlungsereignisse: Erstzahlung, Folgezahlung, Erstattung, Kündigung, Pause …
create table legacy.thrivecart_events (
  event_id        bigint primary key,
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet.
  id text generated always as (event_id::text) stored,
  order_id        bigint,
  invoice_number  bigint,
  subscription_id bigint,
  event_type      text not null,
  occurred_at     timestamptz not null,
  amount_cents    bigint,
  processor       text,
  transaction_id  text,
  source_row      jsonb not null,
  imported_at     timestamptz not null default now()
);
create index thrivecart_events_order_idx on legacy.thrivecart_events (order_id);

-- Abos und Ratenpläne. remote_subscription_id ist die ID bei Stripe oder PayPal und
-- wird für den späteren Umzug der laufenden Abos gebraucht.
create table legacy.thrivecart_subscriptions (
  subscription_id        bigint primary key,
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet.
  id text generated always as (subscription_id::text) stored,
  order_id               bigint,
  invoice_number         bigint references legacy.thrivecart_invoices (invoice_number),
  customer_id            uuid references app.customers (id),
  email                  text not null,
  status                 text not null,
  processor              text,
  remote_subscription_id text,
  frequency              text,
  currency               char(3),
  amount_cents           bigint,
  payments_made          integer,
  payments_remaining     integer,
  total_paid_cents       bigint,
  started_at             timestamptz,
  last_payment_at        timestamptz,
  next_payment_at        timestamptz,
  thrivecart_product_id  bigint,
  product_id             uuid references app.products (id),
  source_row             jsonb not null,
  imported_at            timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index thrivecart_subscriptions_status_idx on legacy.thrivecart_subscriptions (status);

-- Unveränderbar nach dem Import. Einzige Ausnahme: PDF einmalig nachtragen.
create or replace function legacy.thrivecart_invoices_guard() returns trigger
language plpgsql as $$
begin
  if old.pdf_sha256 is null and new.pdf_sha256 is not null
     and (to_jsonb(new) - 'id' - 'pdf_sha256' - 'pdf_storage_key') = (to_jsonb(old) - 'id' - 'pdf_sha256' - 'pdf_storage_key') then
    return new;
  end if;
  raise exception 'GoBD: Thrivecart-Rechnung % ist archiviert und unveränderbar', old.invoice_number
    using errcode = 'P0001';
end;
$$;

create trigger thrivecart_invoices_guard
  before update on legacy.thrivecart_invoices
  for each row execute function legacy.thrivecart_invoices_guard();

-- Käufe: Betrag, Datum, Rechnung und Produkt aus Thrivecart bleiben, wie sie sind.
create or replace function legacy.thrivecart_orders_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'id' - 'status' - 'source_row' - 'customer_id' - 'product_id')
     is distinct from (to_jsonb(old) - 'id' - 'status' - 'source_row' - 'customer_id' - 'product_id') then
    raise exception 'GoBD: Thrivecart-Kauf % ist archiviert, nur der Status darf sich ändern', old.order_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger thrivecart_orders_guard
  before update on legacy.thrivecart_orders
  for each row execute function legacy.thrivecart_orders_guard();

create trigger thrivecart_events_immutable
  before update on legacy.thrivecart_events
  for each row execute function app.forbid_change();

do $$
declare
  t text;
begin
  foreach t in array array['thrivecart_orders', 'thrivecart_events', 'thrivecart_invoices', 'thrivecart_subscriptions'] loop
    execute format(
      'create trigger %I before delete on legacy.%I for each row execute function app.forbid_change()',
      t || '_no_delete', t);
    execute format(
      'create trigger %I before truncate on legacy.%I for each statement execute function app.forbid_change()',
      t || '_no_truncate', t);
    execute format(
      'create trigger %I after insert or update or delete on legacy.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;
