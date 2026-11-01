-- 0025 Abo pausieren und fortsetzen.
--
--  * Eine Pause gilt für ein laufendes Abo ab einem Tag, befristet bis zu einem Tag oder
--    unbefristet bis zum Fortsetzen. Raten- und Anzahlungspläne lassen sich nicht pausieren.
--  * Fälligkeiten im Pausenzeitraum werden nicht eingezogen, sondern „erlassen“: Betrag und
--    Termin bleiben, wie sie sind (GoBD), es gibt keine Rechnung. Spätere Fälligkeiten laufen
--    nach dem bei der Bestellung festgeschriebenen Plan weiter.
--  * Eine Pause wird nie gelöscht. Nachgetragen werden darf genau einmal das Ende
--    (Fortsetzen einer unbefristeten oder vorzeitiges Ende einer befristeten Pause).
--  * Höchstens eine Pause je Abo ist gleichzeitig offen.

create table app.subscription_pauses (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references app.orders (id),
  starts_on     date not null,
  -- Letzter Tag der Pause; null = unbefristet, bis fortgesetzt wird.
  ends_on       date,
  reason        text check (reason is null or length(trim(reason)) > 0),
  created_by    text not null,
  created_at    timestamptz not null default now(),
  -- Wer die Pause beendet hat, wenn ends_on nachgetragen wurde.
  ended_by      text,
  -- Ein Tag vor Beginn = Pause aufgehoben, bevor sie begonnen hat.
  check (ends_on is null or ends_on >= starts_on - 1)
);
create index subscription_pauses_order_idx on app.subscription_pauses (order_id, starts_on);

create or replace function app.subscription_pauses_guard() returns trigger
language plpgsql as $$
begin
  -- Erlaubt ist nur: ein offenes Ende einmal setzen, oder ein befristetes Ende einmal vorziehen.
  if (to_jsonb(new) - 'ends_on' - 'ended_by') is distinct from (to_jsonb(old) - 'ends_on' - 'ended_by')
     or old.ended_by is not null
     or new.ended_by is null
     or new.ends_on is null
     or (old.ends_on is not null and new.ends_on > old.ends_on) then
    raise exception 'GoBD: Pause % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger subscription_pauses_guard
  before update on app.subscription_pauses
  for each row execute function app.subscription_pauses_guard();
create trigger subscription_pauses_no_delete
  before delete on app.subscription_pauses
  for each row execute function app.forbid_change();
create trigger subscription_pauses_no_truncate
  before truncate on app.subscription_pauses
  for each statement execute function app.forbid_change();
create trigger subscription_pauses_audit
  after insert or update or delete on app.subscription_pauses
  for each row execute function app.audit_row();

-- Meldungen an n8n/HubSpot für Pause und Fortsetzung.
alter table app.webhook_outbox drop constraint webhook_outbox_event_type_check;
alter table app.webhook_outbox add constraint webhook_outbox_event_type_check check (event_type in (
  'zahlung.eingegangen', 'zahlung.erstattet', 'abo.beendet', 'bestellung.beendet', 'abo.pausiert', 'abo.fortgesetzt'));
