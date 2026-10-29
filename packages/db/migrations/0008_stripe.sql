-- 0008 Bezahlung über Stripe.
--
--  * Zu jeder Fälligkeit merkt sich das System die Stripe-Zahlungsabsicht
--    (PaymentIntent), die der Kundin angezeigt wurde. Lädt sie die Seite neu,
--    wird dieselbe Absicht wieder verwendet. So entsteht keine zweite Zahlung.
--  * Jede Meldung von Stripe (Webhook) wird mit vollständigem Inhalt und dem
--    Ergebnis der Verbuchung abgelegt. Eine eingegangene Zahlung, die nicht
--    verbucht werden konnte (z. B. Betrag passt nicht), bleibt so nachweisbar
--    und kann von Hand geklärt werden.
--  * Beide Tabellen sind nach dem Schreiben unveränderbar.

create table app.stripe_payment_intents (
  id             text primary key check (id ~ '^pi_'),
  installment_id uuid not null references app.order_installments (id),
  amount_cents   bigint not null check (amount_cents > 0),
  currency       char(3) not null,
  created_at     timestamptz not null default now()
);
create index stripe_payment_intents_installment_idx on app.stripe_payment_intents (installment_id, created_at desc);

create table app.stripe_events (
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet: die Stripe-Ereignis-ID.
  id             text primary key check (id ~ '^evt_'),
  type           text not null,
  payment_intent text,
  -- gebucht, schon_gebucht, ignoriert oder pruefen (Zahlung eingegangen, aber nicht verbucht).
  outcome        text not null check (outcome in ('gebucht', 'schon_gebucht', 'ignoriert', 'pruefen')),
  outcome_note   text,
  invoice_id     uuid references app.invoices (id),
  payload        jsonb not null,
  received_at    timestamptz not null default now()
);
create index stripe_events_review_idx on app.stripe_events (received_at) where outcome = 'pruefen';

-- Kein eindeutiger Schlüssel: In den Thrivecart-Altdaten kann ein Stripe-Kunde an
-- mehreren Kundendatensätzen hängen.
create index customers_stripe_customer_idx on app.customers (stripe_customer_id) where stripe_customer_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['stripe_payment_intents', 'stripe_events'] loop
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
