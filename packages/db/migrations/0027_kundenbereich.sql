-- 0027 Kundenbereich per E-Mail-Link.
--
-- Kundinnen sehen ihre Bestellungen, Zahlpläne und Rechnungen, ändern die Karte für
-- Raten und Abos und finden Kündigung und Widerruf. Kein Passwort: Der Link geht an die
-- E-Mail-Adresse der Bestellungen und gilt einige Tage. Gespeichert wird nur der Hash.

alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check check (purpose in (
  'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung', 'anmeldung', 'kundenbereich'));

create table app.customer_portal_links (
  id          uuid primary key default gen_random_uuid(),
  -- E-Mail-Adresse in Kleinbuchstaben: Eine Kundin ist die Gruppe aller Datensätze mit dieser Adresse.
  email_key   text not null check (email_key = lower(email_key) and email_key like '%@%'),
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  -- kundin = selbst angefordert, user:<id> = aus der Verwaltung geschickt.
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create index customer_portal_links_email_idx on app.customer_portal_links (email_key, created_at);

create trigger customer_portal_links_audit
  after insert on app.customer_portal_links
  for each row execute function app.audit_row();
