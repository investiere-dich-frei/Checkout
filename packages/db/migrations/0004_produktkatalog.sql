-- 0004 Produktkatalog: Übernahme aus Thrivecart und Steuerfreigabe.
--
--  * Produkte und Preisoptionen tragen ihre Thrivecart-ID, damit ein erneuter
--    Import dieselben Zeilen trifft und alte Bestellungen zuordenbar bleiben.
--  * Ein Produkt ist erst verkaufbar (active), wenn seine Steuerkategorie
--    bestätigt ist. Ein Import bestätigt nie selbst.
--  * Preisoptionen beschreiben den ganzen Zahlplan: erste Zahlung, Folgezahlungen,
--    Abstand und Probezeit.

alter table app.products
  add column thrivecart_product_id bigint unique,
  add column internal_label        text,
  add column slug                  text unique,
  -- Status im Herkunftssystem, z. B. live, test, disabled. Nur zur Information.
  add column source_status         text,
  -- Verweise auf andere Systeme (HubSpot, LearningSuite, Upsells in Thrivecart).
  add column external_refs         jsonb not null default '{}',
  -- Woher die Steuerkategorie stammt, und wann und von wem sie bestätigt wurde.
  add column tax_source            text,
  add column tax_confirmed_at      timestamptz,
  add column tax_confirmed_by      uuid references app.users (id);

alter table app.products alter column active set default false;

-- not valid: bestehende Zeilen bleiben unberührt, neue und geänderte werden geprüft.
alter table app.products
  add constraint products_active_needs_tax_confirmation
  check (not active or tax_confirmed_at is not null) not valid;

alter table app.products
  add constraint products_tax_confirmation_complete
  check ((tax_confirmed_at is null) = (tax_confirmed_by is null)) not valid;

-- Bedeutung der Beträge einer Preisoption:
--   amount_cents            erste Zahlung beim Kauf (0 bei Probezeit ohne Anzahlung)
--   recurring_amount_cents  Betrag jeder Folgezahlung
--   recurring_count         Anzahl der Folgezahlungen; leer = unbegrenzt (Abo)
--   interval_months         Abstand der Folgezahlungen
--   trial_days              Tage bis zur ersten Folgezahlung; leer = ein Intervall
--   installments            Gesamtzahl der Zahlungen mit Betrag (nur bei Raten)
alter table app.price_options
  add column thrivecart_option_id   text,
  -- Thrivecart führt Preise ohne Steuer; die Steuer kommt im Checkout dazu.
  add column amount_basis           text not null default 'brutto' check (amount_basis in ('brutto', 'netto')),
  add column recurring_amount_cents bigint check (recurring_amount_cents is null or recurring_amount_cents >= 0),
  add column recurring_count        integer check (recurring_count is null or recurring_count > 0),
  add column trial_days             integer check (trial_days is null or trial_days > 0),
  add constraint price_options_thrivecart_unique unique (product_id, thrivecart_option_id);

alter table app.price_options
  add constraint price_options_plan_complete
  check (
    case kind
      when 'einmal' then recurring_amount_cents is null and recurring_count is null
      when 'abo' then recurring_amount_cents is not null and recurring_count is null
      else recurring_amount_cents is not null and recurring_count is not null
    end
  ) not valid;
