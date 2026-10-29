-- 0011 Nachweis der USt-IdNr.-Prüfung (VIES) für Reverse Charge.
--
-- Reverse Charge gilt nur mit gültiger USt-IdNr. der Kundin. Jede Abfrage beim
-- VIES-System der EU wird mit Ergebnis und Abfragenummer festgehalten und der
-- Bestellung zugeordnet. Nach dem Schreiben unveränderbar.

create table app.vat_id_checks (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references app.orders (id),
  country_code        char(2) not null,
  vat_number          text not null,
  -- true gültig, false ungültig, null: VIES nicht erreichbar.
  valid               boolean,
  -- Abfragenummer der EU (qualifizierte Bestätigung), wenn VIES sie liefert.
  consultation_number text,
  registered_name     text,
  registered_address  text,
  response            jsonb,
  checked_at          timestamptz not null default now()
);
create index vat_id_checks_order_idx on app.vat_id_checks (order_id);

create trigger vat_id_checks_immutable
  before update or delete on app.vat_id_checks
  for each row execute function app.forbid_change();
create trigger vat_id_checks_no_truncate
  before truncate on app.vat_id_checks
  for each statement execute function app.forbid_change();
create trigger vat_id_checks_audit
  after insert or update or delete on app.vat_id_checks
  for each row execute function app.audit_row();
