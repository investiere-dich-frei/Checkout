-- 0022 Gutscheine (Coupons), wie in Thrivecart.
--
--  * Ein Gutschein mindert den Preis prozentual oder um einen festen Betrag, entweder
--    nur die erste Zahlung oder jede Zahlung (Raten, Abo). Er kann zeitlich begrenzt,
--    in der Zahl der Einlösungen begrenzt und auf bestimmte Produkte beschränkt sein.
--  * Bei der Bestellung wird der Rabatt in Fälligkeiten und Rechnungen eingerechnet
--    und mit allen Werten des Gutscheins in app.order_discounts festgeschrieben.
--    Spätere Änderungen am Gutschein berühren abgeschlossene Bestellungen nicht.
--  * Ist ein Gutschein eingelöst, bleiben Code, Art, Höhe und Geltung fest; nur
--    Zeitraum, Limit, Produkte, Bezeichnung und an/aus lassen sich noch ändern.
--  * Gutscheine werden nie gelöscht, nur abgeschaltet.

create table app.coupons (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references app.companies (id),
  code            text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  -- Interne Bezeichnung, z. B. „Black Friday 2026“. Erscheint nicht beim Kunden.
  label           text not null default '',
  kind            text not null check (kind in ('prozent', 'betrag')),
  percent_bp      integer check (percent_bp between 1 and 9999),
  amount_cents    bigint check (amount_cents > 0),
  currency        char(3) not null default 'EUR',
  -- erste: nur die erste Zahlung mit Betrag; alle: jede Zahlung.
  scope           text not null check (scope in ('erste', 'alle')),
  all_products    boolean not null default true,
  product_ids     uuid[] not null default '{}',
  valid_from      timestamptz,
  valid_until     timestamptz,
  max_redemptions integer check (max_redemptions > 0),
  active          boolean not null default true,
  created_by      uuid references app.users (id),
  created_at      timestamptz not null default now(),
  unique (company_id, code),
  check ((kind = 'prozent') = (percent_bp is not null)),
  check ((kind = 'betrag') = (amount_cents is not null)),
  check (valid_from is null or valid_until is null or valid_from < valid_until),
  check (all_products or cardinality(product_ids) > 0)
);

create table app.order_discounts (
  order_item_id        uuid primary key references app.order_items (id),
  order_id             uuid not null references app.orders (id),
  coupon_id            uuid not null references app.coupons (id),
  -- Stand des Gutscheins bei der Bestellung.
  code                 text not null,
  kind                 text not null check (kind in ('prozent', 'betrag')),
  percent_bp           integer,
  amount_cents         bigint,
  scope                text not null check (scope in ('erste', 'alle')),
  -- Worauf der Rabatt gerechnet wurde: Preis der Preisoption brutto oder netto.
  amount_basis         text not null check (amount_basis in ('brutto', 'netto')),
  -- Summen brutto über die bei der Bestellung festgeschriebenen Fälligkeiten.
  list_gross_cents     bigint not null check (list_gross_cents >= 0),
  discount_gross_cents bigint not null check (discount_gross_cents >= 0),
  created_at           timestamptz not null default now(),
  check (discount_gross_cents <= list_gross_cents)
);
create index order_discounts_coupon_idx on app.order_discounts (coupon_id);
create index order_discounts_order_idx on app.order_discounts (order_id);

create or replace function app.coupons_guard() returns trigger
language plpgsql as $$
begin
  if (new.company_id, new.code, new.kind, new.percent_bp, new.amount_cents, new.currency, new.scope, new.created_by, new.created_at)
     is distinct from
     (old.company_id, old.code, old.kind, old.percent_bp, old.amount_cents, old.currency, old.scope, old.created_by, old.created_at)
     and exists (select 1 from app.order_discounts where coupon_id = old.id) then
    raise exception 'GoBD: Gutschein % ist eingelöst; Code und Rabatt bleiben fest', old.code using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger coupons_guard
  before update on app.coupons
  for each row execute function app.coupons_guard();
create trigger coupons_no_delete
  before delete on app.coupons
  for each row execute function app.forbid_change();
create trigger coupons_no_truncate
  before truncate on app.coupons
  for each statement execute function app.forbid_change();
create trigger coupons_audit
  after insert or update or delete on app.coupons
  for each row execute function app.audit_row();

create trigger order_discounts_immutable
  before update or delete on app.order_discounts
  for each row execute function app.forbid_change();
create trigger order_discounts_no_truncate
  before truncate on app.order_discounts
  for each statement execute function app.forbid_change();
create trigger order_discounts_audit
  after insert or update or delete on app.order_discounts
  for each row execute function app.audit_row();
