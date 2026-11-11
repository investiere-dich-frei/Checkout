-- 0034 Ratenkauf nach neuem Verbraucherkreditrecht (ab 20.11.2026).
--
-- Raten, die länger als 50 Tage laufen oder etwas extra kosten, sind ein Kredit (§ 506 BGB n. F.).
-- Dafür braucht es vor dem Vertrag eine Bonitätsprüfung und die Europäische Standardinformation,
-- dann einen eigenen Ratenvertrag mit Zustimmung, Widerrufsinformation und Erinnerung.
--
--  credit_settings:         Schalter und Regeln der Prüfung (eine Zeile, Änderungen im Audit-Log).
--  credit_checks:           jede Prüfung mit Eingaben, Verfahren, Regeln und Ergebnis; festgeschrieben.
--  credit_check_decisions:  Entscheidung des Teams bei gelb (oder Überprüfung auf Wunsch); festgeschrieben.
--  credit_documents:        die verschickten Texte (Standardinformation, Ratenvertrag) im Wortlaut; festgeschrieben.
--  orders:                  Verweis auf die Prüfung, Zeitpunkt der Zustimmung zum Ratenvertrag und zum Sofortstart
--                           mit Wertersatz.

select set_config('app.actor', 'system:migration-0034', true);

create table app.credit_settings (
  id                               boolean primary key default true check (id),
  -- Ratenkauf mit Kredit ist erst verkaufbar, wenn hier eingeschaltet (nach Prüfung der Rechtstexte).
  enabled                          boolean not null default false,
  contact_email                    text not null default 'service@investieredichfrei.de',
  contact_phone                    text,
  living_cost_cents                bigint not null default 60000 check (living_cost_cents >= 0),
  living_cost_per_dependent_cents  bigint not null default 40000 check (living_cost_per_dependent_cents >= 0),
  green_max_share_bp               integer not null default 5000 check (green_max_share_bp between 1 and 10000),
  manual_review_from_cents         bigint check (manual_review_from_cents is null or manual_review_from_cents >= 0),
  bureau_from_cents                bigint check (bureau_from_cents is null or bureau_from_cents >= 0),
  updated_at                       timestamptz not null default now(),
  updated_by                       text not null default 'system'
);
insert into app.credit_settings (id) values (true);
create trigger credit_settings_no_delete before delete on app.credit_settings for each row execute function app.forbid_change();
create trigger credit_settings_audit after insert or update or delete on app.credit_settings for each row execute function app.audit_row();

create table app.credit_checks (
  id                  uuid primary key default gen_random_uuid(),
  price_option_id     uuid not null references app.price_options (id),
  -- Verfahren, z. B. 'fragebogen' oder später 'auskunftei:schufa'.
  method              text not null check (method ~ '^[a-z]+(:[a-z0-9_-]+)?$'),
  rules_version       text not null,
  -- Kopie der Regeln (Grenzwerte), die bei dieser Prüfung galten.
  rules               jsonb not null,
  -- Angaben aus dem Kaufformular (Name, Anschrift, E-Mail …), für den zweiten Schritt.
  customer            jsonb not null,
  email               text not null,
  coupon_code         text,
  seller_user_id      uuid references app.users (id),
  answers             jsonb not null,
  purchase_day        date not null,
  monthly_rate_cents  bigint not null check (monthly_rate_cents >= 0),
  credit_cents        bigint not null check (credit_cents >= 0),
  free_income_cents   bigint,
  result              text not null check (result in ('gruen', 'gelb', 'rot')),
  reasons             jsonb not null,
  -- Ergebnis einer Auskunftei, falls abgefragt (Verfahren, Score, Merkmale); nie Kartendaten.
  bureau_response     jsonb,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null
);
create index credit_checks_open_idx on app.credit_checks (created_at desc) where result = 'gelb';
create trigger credit_checks_immutable before update or delete on app.credit_checks for each row execute function app.forbid_change();
create trigger credit_checks_no_truncate before truncate on app.credit_checks for each statement execute function app.forbid_change();
create trigger credit_checks_audit after insert or update or delete on app.credit_checks for each row execute function app.audit_row();

create table app.credit_check_decisions (
  id               uuid primary key default gen_random_uuid(),
  credit_check_id  uuid not null unique references app.credit_checks (id),
  decision         text not null check (decision in ('freigegeben', 'abgelehnt')),
  note             text not null check (length(trim(note)) > 0),
  decided_by       text not null,
  decided_at       timestamptz not null default now()
);
create trigger credit_check_decisions_immutable before update or delete on app.credit_check_decisions for each row execute function app.forbid_change();
create trigger credit_check_decisions_no_truncate before truncate on app.credit_check_decisions for each statement execute function app.forbid_change();
create trigger credit_check_decisions_audit after insert or update or delete on app.credit_check_decisions for each row execute function app.audit_row();

alter table app.orders
  add column credit_check_id                uuid unique references app.credit_checks (id),
  add column credit_agreement_at            timestamptz,
  add column value_compensation_consent_at  timestamptz,
  add column credit_texts_version           text,
  add constraint orders_credit_consistent check (
    (credit_check_id is null) = (credit_agreement_at is null)
    and (credit_check_id is null) = (credit_texts_version is null)
    and (value_compensation_consent_at is null or credit_check_id is not null)
    and (credit_check_id is null or withdrawal_waiver_at is null)
  );

create table app.credit_documents (
  id               uuid primary key default gen_random_uuid(),
  credit_check_id  uuid not null references app.credit_checks (id),
  order_id         uuid references app.orders (id),
  kind             text not null check (kind in ('standardinformation', 'ratenvertrag')),
  version          text not null,
  content          text not null,
  sha256           text not null,
  created_at       timestamptz not null default now(),
  check ((kind = 'ratenvertrag') = (order_id is not null))
);
create index credit_documents_check_idx on app.credit_documents (credit_check_id, created_at);
create trigger credit_documents_immutable before update or delete on app.credit_documents for each row execute function app.forbid_change();
create trigger credit_documents_no_truncate before truncate on app.credit_documents for each statement execute function app.forbid_change();
create trigger credit_documents_audit after insert or update or delete on app.credit_documents for each row execute function app.audit_row();

alter table app.mail_outbox drop constraint mail_outbox_purpose_check;
alter table app.mail_outbox add constraint mail_outbox_purpose_check check (purpose in (
  'kuendigung_bestaetigung', 'widerruf_bestaetigung', 'bestellbestaetigung', 'rechnung', 'anmeldung', 'kundenbereich',
  'mahnwesen', 'ratenkauf'));
