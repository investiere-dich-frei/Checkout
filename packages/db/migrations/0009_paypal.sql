-- 0008 Bezahlung über PayPal, als eigene Zahlungsart neben Stripe.
--
--  * Zu jeder Fälligkeit merkt sich das System die PayPal-Bestellung, die es
--    angelegt hat. Nur solche Bestellungen werden verbucht.
--  * Jede Zahlungsbestätigung (direkt nach der Freigabe durch die Kundin oder
--    später per Webhook) wird mit vollständigem Inhalt und Ergebnis abgelegt.
--    Gebucht wird je PayPal-Zahlung (Capture) genau einmal.
--  * Beide Tabellen sind nach dem Schreiben unveränderbar.

create table app.paypal_orders (
  id             text primary key,
  installment_id uuid not null references app.order_installments (id),
  amount_cents   bigint not null check (amount_cents > 0),
  currency       char(3) not null,
  created_at     timestamptz not null default now()
);
create index paypal_orders_installment_idx on app.paypal_orders (installment_id, created_at desc);

create table app.paypal_events (
  -- Webhook-Ereignis-ID von PayPal oder „capture:<id>“ für die direkte Bestätigung.
  id             text primary key,
  type           text not null,
  paypal_order   text,
  capture_id     text,
  outcome        text not null check (outcome in ('gebucht', 'schon_gebucht', 'ignoriert', 'pruefen')),
  outcome_note   text,
  invoice_id     uuid references app.invoices (id),
  payload        jsonb not null,
  received_at    timestamptz not null default now()
);
create index paypal_events_review_idx on app.paypal_events (received_at) where outcome = 'pruefen';

do $$
declare
  t text;
begin
  foreach t in array array['paypal_orders', 'paypal_events'] loop
    execute format(
      'create trigger %I before update or delete on app.%I for each row execute function app.forbid_change()',
      t || '_immutable', t);
    execute format(
      'create trigger %I before truncate on app.%I for each statement execute function app.forbid_change()',
      t || '_no_truncate', t);
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;
