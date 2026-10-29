-- 0009 Kündigungsbutton (§ 312k BGB), Widerrufsbutton (§ 356a BGB) und Postausgang.
--
--  * Jede Kündigung und jeder Widerruf über die Website wird mit allen Angaben und
--    dem Zeitpunkt des Eingangs festgehalten und danach nie mehr geändert. Das ist
--    der Nachweis, dass und wann die Erklärung eingegangen ist.
--  * Die Erklärung wird, wenn möglich, gleich einer Bestellung zugeordnet: einer
--    neuen Bestellung oder einem Kauf aus Thrivecart. Ohne Zuordnung bleibt sie
--    trotzdem gültig und wird von Hand geklärt.
--  * E-Mails gehen über den Postausgang (mail_outbox). Ein eigener Lauf verschickt
--    sie; Inhalt und Empfänger sind nach dem Anlegen unveränderbar, nur der
--    Versandstand wird fortgeschrieben.

create table app.mail_outbox (
  id                  uuid primary key default gen_random_uuid(),
  purpose             text not null check (purpose in (
                        'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung')),
  to_address          text not null check (to_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject             text not null,
  body_text           text not null,
  -- Verweis auf den Anlass, z. B. die Rechnung (für spätere Anhänge).
  related_id          uuid,
  created_at          timestamptz not null default now(),
  attempts            integer not null default 0 check (attempts >= 0),
  last_error          text,
  next_attempt_at     timestamptz not null default now(),
  sent_at             timestamptz,
  provider_message_id text
);
create index mail_outbox_pending_idx on app.mail_outbox (next_attempt_at) where sent_at is null;

-- Inhalt und Empfänger bleiben, wie sie angelegt wurden; einmal versendet bleibt versendet.
create or replace function app.mail_outbox_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'attempts' - 'last_error' - 'next_attempt_at' - 'sent_at' - 'provider_message_id')
     is distinct from (to_jsonb(old) - 'attempts' - 'last_error' - 'next_attempt_at' - 'sent_at' - 'provider_message_id')
     or (old.sent_at is not null and new.sent_at is distinct from old.sent_at) then
    raise exception 'GoBD: E-Mail % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger mail_outbox_guard
  before update on app.mail_outbox
  for each row execute function app.mail_outbox_guard();

create table app.contract_notices (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('kuendigung', 'widerruf')),
  full_name          text not null check (length(trim(full_name)) > 0),
  email              text not null,
  -- Was die Kundin zur Bezeichnung des Vertrags angegeben hat (Bestell-, Rechnungsnummer, Produkt).
  contract_reference text not null check (length(trim(contract_reference)) > 0),
  -- Nur bei Kündigung: ordentlich oder außerordentlich (dann mit Grund).
  cancellation_type  text check (cancellation_type in ('ordentlich', 'ausserordentlich')),
  reason             text,
  -- Gewünschtes Vertragsende: null bedeutet „zum nächstmöglichen Zeitpunkt“.
  requested_end      date,
  message            text,
  order_id           uuid references app.orders (id),
  thrivecart_order_id bigint references legacy.thrivecart_orders (order_id),
  customer_id        uuid references app.customers (id),
  confirmation_mail_id uuid not null references app.mail_outbox (id),
  received_at        timestamptz not null default now(),
  check ((kind = 'kuendigung') = (cancellation_type is not null)),
  check (cancellation_type is distinct from 'ausserordentlich' or length(trim(coalesce(reason, ''))) > 0),
  check (kind = 'kuendigung' or requested_end is null)
);
create index contract_notices_received_idx on app.contract_notices (received_at);
create index contract_notices_order_idx on app.contract_notices (order_id) where order_id is not null;

create trigger contract_notices_immutable
  before update or delete on app.contract_notices
  for each row execute function app.forbid_change();

do $$
declare
  t text;
begin
  foreach t in array array['mail_outbox', 'contract_notices'] loop
    execute format(
      'create trigger %I before truncate on app.%I for each statement execute function app.forbid_change()',
      t || '_no_truncate', t);
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;

create trigger mail_outbox_no_delete
  before delete on app.mail_outbox
  for each row execute function app.forbid_change();
