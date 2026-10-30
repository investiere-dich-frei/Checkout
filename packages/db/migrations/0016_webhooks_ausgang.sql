-- 0016 Ausgehende Webhooks, z. B. an n8n für Kurszugang (LearningSuite) und HubSpot.
--
-- Ereignisse entstehen in derselben Transaktion wie ihr Anlass und werden von
-- einem eigenen Lauf zugestellt, signiert mit HMAC-SHA256. Inhalt ist nach dem
-- Anlegen unveränderbar, nur der Zustellstand wird fortgeschrieben.

create table app.webhook_outbox (
  id               uuid primary key default gen_random_uuid(),
  event_type       text not null check (event_type in (
                     'zahlung.eingegangen', 'zahlung.erstattet', 'abo.beendet', 'bestellung.beendet')),
  payload          jsonb not null,
  created_at       timestamptz not null default now(),
  attempts         integer not null default 0 check (attempts >= 0),
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  delivered_at     timestamptz,
  response_status  integer
);
create index webhook_outbox_pending_idx on app.webhook_outbox (next_attempt_at) where delivered_at is null;

create or replace function app.webhook_outbox_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'attempts' - 'last_error' - 'next_attempt_at' - 'delivered_at' - 'response_status')
     is distinct from (to_jsonb(old) - 'attempts' - 'last_error' - 'next_attempt_at' - 'delivered_at' - 'response_status')
     or (old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at) then
    raise exception 'GoBD: Webhook % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger webhook_outbox_guard
  before update on app.webhook_outbox
  for each row execute function app.webhook_outbox_guard();
create trigger webhook_outbox_no_delete
  before delete on app.webhook_outbox
  for each row execute function app.forbid_change();
create trigger webhook_outbox_no_truncate
  before truncate on app.webhook_outbox
  for each statement execute function app.forbid_change();
