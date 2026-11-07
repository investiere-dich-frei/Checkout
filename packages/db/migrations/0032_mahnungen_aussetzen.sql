-- 0032 Mahnungen je Bestellung aussetzen, z. B. wenn der Vertrieb einen Zahlungsaufschub vereinbart hat.
--
-- Solange eine Aussetzung gilt, verschickt das Mahnwesen für diese Bestellung keine E-Mails
-- (Erinnerung, fehlgeschlagen, letzte Mahnung, Karte läuft ab). Der automatische Einzug läuft weiter.
-- Einträge sind festgeschrieben: Nur das Aufheben (ended_at, ended_by) darf einmal nachgetragen werden.

create table app.dunning_holds (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references app.orders (id),
  -- Letzter Tag der Aussetzung; null = bis auf Weiteres.
  ends_on     date,
  reason      text not null check (length(trim(reason)) > 0),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  ended_by    text,
  check ((ended_at is null) = (ended_by is null))
);
create index dunning_holds_order_idx on app.dunning_holds (order_id, created_at);

create or replace function app.dunning_holds_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'ended_at' - 'ended_by') is distinct from (to_jsonb(old) - 'ended_at' - 'ended_by')
     or old.ended_at is not null
     or new.ended_at is null then
    raise exception 'GoBD: Aussetzung % ist festgeschrieben', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger dunning_holds_guard
  before update on app.dunning_holds
  for each row execute function app.dunning_holds_guard();
create trigger dunning_holds_no_delete
  before delete on app.dunning_holds
  for each row execute function app.forbid_change();
create trigger dunning_holds_no_truncate
  before truncate on app.dunning_holds
  for each statement execute function app.forbid_change();
create trigger dunning_holds_audit
  after insert or update or delete on app.dunning_holds
  for each row execute function app.audit_row();
