-- 0029 Mahnwesen: E-Mails rund um automatische Abbuchungen.
--
--  * erinnerung:     einige Tage vor der Abbuchung bei Abos und Raten mit langem Abstand
--                    (vierteljährlich und länger), damit niemand von einer großen Abbuchung überrascht wird.
--  * fehlgeschlagen: nach jeder abgelehnten Abbuchung, mit Termin des nächsten Versuchs und Link zum
--                    Kundenbereich, um die Karte zu ändern.
--  * letzte_mahnung: nach dem letzten automatischen Versuch; danach wird nicht mehr abgebucht.
--  * karte_ablauf:   die gespeicherte Karte läuft vor der nächsten Abbuchung ab.
--
-- Jede Benachrichtigung hat einen eindeutigen Schlüssel, damit der tägliche Lauf sie höchstens
-- einmal verschickt. Einträge sind festgeschrieben (Nachweis, wer wann gemahnt wurde).
-- Kartendaten: nur Marke, letzte vier Ziffern und Ablaufdatum, nie die Kartennummer.

alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check check (purpose in (
  'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung', 'anmeldung', 'kundenbereich',
  'mahnwesen'));

create table app.dunning_notices (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('erinnerung', 'fehlgeschlagen', 'letzte_mahnung', 'karte_ablauf')),
  -- z. B. fehlgeschlagen:<rate>:<versuch> oder karte_ablauf:<zahlungsart>
  dedupe_key     text not null unique,
  order_id       uuid not null references app.orders (id),
  installment_id uuid references app.order_installments (id),
  mail_id        uuid not null references app.mail_outbox (id),
  created_at     timestamptz not null default now()
);
create index dunning_notices_order_idx on app.dunning_notices (order_id, created_at);
create trigger dunning_notices_no_update
  before update or delete on app.dunning_notices
  for each row execute function app.forbid_change();
create trigger dunning_notices_no_truncate
  before truncate on app.dunning_notices
  for each statement execute function app.forbid_change();
create trigger dunning_notices_audit
  after insert on app.dunning_notices
  for each row execute function app.audit_row();

-- Ablaufdatum gespeicherter Karten (von Stripe gelesen). Wird bei Bedarf überschrieben.
create table app.payment_method_cards (
  ref         text primary key,
  brand       text,
  last4       text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month   integer not null check (exp_month between 1 and 12),
  exp_year    integer not null check (exp_year between 2000 and 2100),
  fetched_at  timestamptz not null default now()
);

-- Meldung an n8n/HubSpot, wenn eine Abbuchung abgelehnt wurde.
alter table app.webhook_outbox drop constraint webhook_outbox_event_type_check;
alter table app.webhook_outbox add constraint webhook_outbox_event_type_check check (event_type in (
  'zahlung.eingegangen', 'zahlung.erstattet', 'zahlung.teilerstattet', 'zahlung.fehlgeschlagen', 'abo.beendet',
  'bestellung.beendet', 'abo.pausiert', 'abo.fortgesetzt'));
