-- 0001 Grundlagen: Stammdaten, Bestellungen, Zahlungen.
-- Beträge immer als Ganzzahl in Cent (bigint), Währung nach ISO 4217.

create extension if not exists pgcrypto;

create schema if not exists app;

-- Verkäufergesellschaft: Jede Rechnung gehört genau einer Gesellschaft
-- und bekommt deren fortlaufende Nummer.
create table app.companies (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null,
  street        text not null,
  postal_code   text not null,
  city          text not null,
  country       char(2) not null default 'DE',
  vat_id        text,
  tax_number    text,
  register_info text,
  created_at    timestamptz not null default now()
);

create table app.users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  display_name text not null,
  role         text not null check (role in ('admin', 'vertrieb', 'freelancer', 'pruefer')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table app.customers (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('privat', 'unternehmen')),
  first_name   text,
  last_name    text,
  company_name text,
  email        text not null,
  street       text,
  postal_code  text,
  city         text,
  country      char(2) not null,
  vat_id       text,
  created_at   timestamptz not null default now()
);
create index customers_email_idx on app.customers (lower(email));

-- Steuerkategorie am Produkt; der konkrete Satz wird bei der Rechnung
-- als Wert festgeschrieben, damit spätere Regeländerungen alte Belege nicht berühren.
create table app.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references app.companies (id),
  name         text not null,
  tax_category text not null check (tax_category in ('standard', 'steuerfrei_4_21')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table app.price_options (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references app.products (id),
  label              text not null,
  kind               text not null check (kind in ('einmal', 'raten', 'abo', 'anzahlung')),
  currency           char(3) not null default 'EUR',
  amount_cents       bigint not null check (amount_cents >= 0),
  installments       integer check (installments is null or installments > 0),
  interval_months    integer check (interval_months is null or interval_months > 0),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  check (kind <> 'raten' or (installments is not null and interval_months is not null)),
  check (kind <> 'abo' or interval_months is not null)
);

-- Rechtstexte werden versioniert und nie geändert; jede Bestellung verweist
-- auf die Fassung, der der Kunde zugestimmt hat.
create table app.legal_text_versions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('agb', 'datenschutz', 'widerruf')),
  version        text not null,
  content        text not null,
  content_sha256 bytea not null,
  valid_from     timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (kind, version)
);

create or replace function app.legal_text_hash() returns trigger
language plpgsql as $$
begin
  new.content_sha256 := sha256(convert_to(new.content, 'UTF8'));
  return new;
end;
$$;

create trigger legal_text_versions_hash
  before insert on app.legal_text_versions
  for each row execute function app.legal_text_hash();

create table app.orders (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references app.companies (id),
  customer_id            uuid not null references app.customers (id),
  -- Verkäufernachweis: wer den Kauflink geschickt hat (null = ohne Vertrieb).
  seller_user_id         uuid references app.users (id),
  status                 text not null check (status in ('offen', 'bezahlt', 'teilbezahlt', 'storniert', 'erstattet')),
  currency               char(3) not null default 'EUR',
  total_gross_cents      bigint not null check (total_gross_cents >= 0),
  agb_version_id         uuid not null references app.legal_text_versions (id),
  privacy_version_id     uuid not null references app.legal_text_versions (id),
  withdrawal_version_id  uuid not null references app.legal_text_versions (id),
  -- § 356 Abs. 5 BGB: ausdrückliche Zustimmung und Bestätigung zum vorzeitigen Beginn.
  withdrawal_waiver_at   timestamptz,
  created_at             timestamptz not null default now()
);
create index orders_seller_idx on app.orders (seller_user_id, created_at);

create table app.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references app.orders (id),
  price_option_id uuid not null references app.price_options (id),
  quantity        integer not null default 1 check (quantity > 0),
  amount_cents    bigint not null check (amount_cents >= 0)
);

create table app.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references app.orders (id),
  provider      text not null check (provider in ('stripe', 'paypal', 'ueberweisung', 'mollie', 'thrivecart_import')),
  provider_ref  text not null,
  status        text not null check (status in ('ausstehend', 'bezahlt', 'fehlgeschlagen', 'erstattet')),
  currency      char(3) not null,
  amount_cents  bigint not null,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (provider, provider_ref)
);
