-- 0013 Wiederkehrende Zahlungen: Abo-Bedingungen, gespeicherte Zahlungsarten, Einzugsversuche.
--
--  * Die Bedingungen eines Abos (Plan, Kauftag, Steuersatz) werden bei der Bestellung
--    festgeschrieben. Spätere Preisänderungen im Katalog berühren laufende Abos nicht.
--    Das Ende (nach Kündigung) wird einmal gesetzt und nicht mehr geändert.
--  * Gespeicherte Zahlungsarten (Stripe-Zahlungsmethode, PayPal-Vault) für den Einzug
--    weiterer Raten. Sie können einmal widerrufen werden.
--  * Jeder Einzugsversuch steht mit Ergebnis unveränderbar fest.

create table app.subscription_terms (
  order_item_id   uuid primary key references app.order_items (id),
  order_id        uuid not null references app.orders (id),
  -- Plan wie bei der Bestellung: kind, amountCents, recurringAmountCents, recurringCount, intervalMonths, trialDays.
  plan            jsonb not null,
  purchase_day    date not null,
  amount_basis    text not null check (amount_basis in ('brutto', 'netto')),
  tax_rate_bp     integer not null check (tax_rate_bp between 0 and 10000),
  -- Letzter Tag der Laufzeit nach Kündigung; null = läuft.
  ends_on         date,
  ended_by        text,
  created_at      timestamptz not null default now(),
  check ((ends_on is null) = (ended_by is null))
);
create index subscription_terms_running_idx on app.subscription_terms (order_id) where ends_on is null;

create or replace function app.subscription_terms_guard() returns trigger
language plpgsql as $$
begin
  if old.ends_on is not null
     or (to_jsonb(new) - 'ends_on' - 'ended_by') is distinct from (to_jsonb(old) - 'ends_on' - 'ended_by') then
    raise exception 'GoBD: Abo-Bedingungen der Bestellung % sind festgeschrieben', old.order_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger subscription_terms_guard
  before update on app.subscription_terms
  for each row execute function app.subscription_terms_guard();

create table app.saved_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references app.customers (id),
  provider    text not null check (provider in ('stripe', 'paypal')),
  -- Stripe: pm_…, dazu der Stripe-Kunde in provider_customer. PayPal: Vault-ID.
  ref         text not null,
  provider_customer text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (provider, ref)
);
create index saved_payment_methods_customer_idx on app.saved_payment_methods (customer_id, created_at desc) where revoked_at is null;

create or replace function app.saved_payment_methods_guard() returns trigger
language plpgsql as $$
begin
  if old.revoked_at is not null
     or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception 'GoBD: gespeicherte Zahlungsart % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger saved_payment_methods_guard
  before update on app.saved_payment_methods
  for each row execute function app.saved_payment_methods_guard();

create table app.charge_attempts (
  id             uuid primary key default gen_random_uuid(),
  installment_id uuid not null references app.order_installments (id),
  provider       text not null check (provider in ('stripe', 'paypal')),
  -- PaymentIntent- oder PayPal-Bestell-ID, falls beim Anbieter angelegt.
  provider_ref   text,
  -- eingereicht: beim Anbieter angenommen, Bestätigung folgt. abgelehnt: Zahlung gescheitert.
  outcome        text not null check (outcome in ('eingereicht', 'gebucht', 'abgelehnt', 'fehler')),
  error_code     text,
  attempted_at   timestamptz not null default now()
);
create index charge_attempts_installment_idx on app.charge_attempts (installment_id, attempted_at);

create trigger charge_attempts_immutable
  before update or delete on app.charge_attempts
  for each row execute function app.forbid_change();

do $$
declare
  t text;
begin
  foreach t in array array['subscription_terms', 'saved_payment_methods', 'charge_attempts'] loop
    execute format(
      'create trigger %I before truncate on app.%I for each statement execute function app.forbid_change()',
      t || '_no_truncate', t);
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;

create trigger subscription_terms_no_delete
  before delete on app.subscription_terms
  for each row execute function app.forbid_change();
create trigger saved_payment_methods_no_delete
  before delete on app.saved_payment_methods
  for each row execute function app.forbid_change();
