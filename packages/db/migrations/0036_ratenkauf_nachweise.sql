-- 0036 Ratenkauf: Nachweise nach der Gegenprüfung vom 11.11.2026.
--
--  credit_documents:  zusätzlich 'standardinformation_bestellung', die Standardinformation genau in der Fassung,
--                     die beim Bestellen angezeigt war (mit Bestellung). Ratenverträge bekommen eine lesbare
--                     Nummer RV-n (eigener Zähler, Lücken sind erlaubt, kein Rechnungskreis).
--  orders:            Zeitpunkt, an dem ein Unternehmen bestätigt hat, für seine gewerbliche oder selbständige
--                     Tätigkeit zu kaufen (nur nötig ohne geprüfte USt-IdNr. bei Raten, die für Privatkundinnen
--                     ein Kredit wären).
--  mail_outbox:       eigene Zwecke für Ratenvertrag und Widerrufserinnerung (Zustellzeitpunkt nachweisbar);
--                     eine vorgemerkte E-Mail kann entfallen (cancelled_at, Grund), solange sie nicht verschickt
--                     ist. Inhalt und Empfänger bleiben unverändert.

select set_config('app.actor', 'system:migration-0036', true);

alter table app.credit_documents drop constraint credit_documents_kind_check;
alter table app.credit_documents drop constraint credit_documents_check;
create sequence app.credit_contract_no_seq;
alter table app.credit_documents
  add column contract_no text unique,
  add constraint credit_documents_kind_check check (kind in ('standardinformation', 'standardinformation_bestellung', 'ratenvertrag')),
  add constraint credit_documents_order_check check ((kind = 'standardinformation') = (order_id is null)),
  add constraint credit_documents_contract_no_check check ((kind = 'ratenvertrag') = (contract_no is not null));

alter table app.orders
  add column business_purpose_confirmed_at timestamptz;

alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check check (purpose in (
  'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung', 'anmeldung', 'kundenbereich',
  'mahnwesen', 'ratenkauf', 'ratenvertrag', 'ratenkauf_erinnerung'));
alter table app.mail_outbox
  add column cancelled_at  timestamptz,
  add column cancel_reason text,
  add constraint mail_outbox_cancel_check check ((cancelled_at is null) = (cancel_reason is null) and (cancelled_at is null or sent_at is null));

drop index app.mail_outbox_pending_idx;
create index mail_outbox_pending_idx on app.mail_outbox (next_attempt_at) where sent_at is null and cancelled_at is null;

-- Wie 0010, zusätzlich darf eine noch nicht verschickte E-Mail einmal als entfallen markiert werden.
create or replace function app.mail_outbox_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'attempts' - 'last_error' - 'next_attempt_at' - 'sent_at' - 'provider_message_id' - 'cancelled_at' - 'cancel_reason')
     is distinct from (to_jsonb(old) - 'attempts' - 'last_error' - 'next_attempt_at' - 'sent_at' - 'provider_message_id' - 'cancelled_at' - 'cancel_reason')
     or (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
     or (old.cancelled_at is not null and (new.cancelled_at, new.cancel_reason) is distinct from (old.cancelled_at, old.cancel_reason))
     or (old.cancelled_at is not null and new.sent_at is not null) then
    raise exception 'GoBD: E-Mail % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
