-- 0026 Laufende Thrivecart-Abos und Ratenpläne in den neuen Checkout übernehmen.
--
--  * Je übernommenem Thrivecart-Abo entsteht eine Bestellung im neuen System. Sie beginnt
--    mit der nächsten Fälligkeit nach dem Stichtag; Zahlungen davor bleiben in Thrivecart
--    (Alt-Rechnungen, archiviert). Die erste Rechnung im Kreis IDF-n entsteht mit der ersten
--    Zahlung im neuen System.
--  * Ein Thrivecart-Abo wird höchstens einmal übernommen (unique).
--  * Der Eintrag ist festgeschrieben. Nachgetragen werden darf genau einmal, dass die
--    Abrechnung in Thrivecart beendet wurde (wer, wann).

create table app.thrivecart_takeovers (
  order_id               uuid primary key references app.orders (id),
  -- Für das Audit-Log, das Zeilen über ihre Spalte id zuordnet (in BEFORE-Triggern noch leer).
  id                     text generated always as (order_id::text) stored,
  subscription_id        bigint not null unique references legacy.thrivecart_subscriptions (subscription_id),
  -- Zahlungsweg: paypal = Abo bleibt bei PayPal, stripe/thrivepay = Karte im eigenen Stripe-Konto.
  route                  text not null check (route in ('paypal', 'stripe', 'thrivepay')),
  -- PayPal-Abo (I-…) oder Stripe-Abo (sub_…), über das bisher abgerechnet wurde.
  remote_subscription_id text not null check (length(trim(remote_subscription_id)) > 0),
  -- Erste Fälligkeit im neuen System.
  first_due_on           date not null,
  -- Ratenplan: so viele Zahlungen waren beim Umzug noch offen. null = Abo ohne Ende.
  remaining_payments     integer check (remaining_payments is null or remaining_payments > 0),
  created_by             text not null,
  created_at             timestamptz not null default now(),
  -- Abrechnung in Thrivecart beendet (einmal nachgetragen).
  thrivecart_stopped_at  timestamptz,
  thrivecart_stopped_by  text,
  check ((thrivecart_stopped_at is null) = (thrivecart_stopped_by is null))
);

create or replace function app.thrivecart_takeovers_guard() returns trigger
language plpgsql as $$
begin
  if old.thrivecart_stopped_at is not null
     or (to_jsonb(new) - 'id' - 'thrivecart_stopped_at' - 'thrivecart_stopped_by')
        is distinct from (to_jsonb(old) - 'id' - 'thrivecart_stopped_at' - 'thrivecart_stopped_by') then
    raise exception 'GoBD: Übernahme der Bestellung % ist festgeschrieben', old.order_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger thrivecart_takeovers_guard
  before update on app.thrivecart_takeovers
  for each row execute function app.thrivecart_takeovers_guard();
create trigger thrivecart_takeovers_no_delete
  before delete on app.thrivecart_takeovers
  for each row execute function app.forbid_change();
create trigger thrivecart_takeovers_no_truncate
  before truncate on app.thrivecart_takeovers
  for each statement execute function app.forbid_change();
create trigger thrivecart_takeovers_audit
  after insert or update or delete on app.thrivecart_takeovers
  for each row execute function app.audit_row();
