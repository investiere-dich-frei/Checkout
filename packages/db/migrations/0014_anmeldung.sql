-- 0014 Anmeldung zur Verwaltung per E-Mail-Link.
--
-- Kein Passwort: Wer sich anmelden will, bekommt einen Link an die hinterlegte
-- Adresse. Gespeichert werden nur Hashes von Link und Sitzung, nie die Werte selbst.
-- Jede Anmeldung steht im Audit-Log.

alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check check (purpose in (
  'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung', 'anmeldung'));

create table app.login_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.users (id),
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table app.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app.users (id),
  session_hash bytea not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index sessions_user_idx on app.sessions (user_id);

do $$
declare
  t text;
begin
  foreach t in array array['login_tokens', 'sessions'] loop
    execute format(
      'create trigger %I after insert or update on app.%I for each row execute function app.audit_row()',
      t || '_audit', t);
  end loop;
end;
$$;

-- Bearbeitung von Kündigungen und Widerrufen: wer was entschieden hat. Unveränderbar;
-- eine Erklärung wird genau einmal erledigt.
create table app.notice_resolutions (
  notice_id   uuid primary key references app.contract_notices (id),
  resolved_by uuid not null references app.users (id),
  resolution  text not null check (length(trim(resolution)) > 0),
  -- Zugeordnete Bestellung, falls bei der Bearbeitung von Hand gefunden.
  order_id    uuid references app.orders (id),
  resolved_at timestamptz not null default now()
);

create trigger notice_resolutions_immutable
  before update or delete on app.notice_resolutions
  for each row execute function app.forbid_change();
create trigger notice_resolutions_no_truncate
  before truncate on app.notice_resolutions
  for each statement execute function app.forbid_change();
create trigger notice_resolutions_audit
  after insert on app.notice_resolutions
  for each row execute function app.audit_row();
