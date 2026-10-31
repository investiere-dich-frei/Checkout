-- 0020 Preisoptionen festschreiben, sobald sie verkauft sind.
--
-- Seit es eine Produktpflege in der Verwaltung gibt, können Preise geändert werden.
-- Rechnungen späterer Raten lesen Bezeichnung und Zahlplan-Art aus der Preisoption,
-- und eine Bestellung muss nachweisbar zu dem Angebot passen, das gekauft wurde.
-- Deshalb gilt: Ist eine Preisoption in einer Bestellung, bleiben Bezeichnung, Preis
-- und Zahlplan fest. Nur ein- und ausschalten geht noch. Für einen neuen Preis
-- wird eine neue Preisoption angelegt und die alte abgeschaltet.

create or replace function app.price_options_sold_guard() returns trigger
language plpgsql as $$
begin
  if (new.product_id, new.label, new.kind, new.currency, new.amount_cents, new.installments, new.interval_months,
      new.amount_basis, new.recurring_amount_cents, new.recurring_count, new.trial_days, new.thrivecart_option_id)
     is distinct from
     (old.product_id, old.label, old.kind, old.currency, old.amount_cents, old.installments, old.interval_months,
      old.amount_basis, old.recurring_amount_cents, old.recurring_count, old.trial_days, old.thrivecart_option_id)
     and exists (select 1 from app.order_items where price_option_id = old.id) then
    raise exception 'GoBD: Preisoption % ist verkauft; Preis und Zahlplan bleiben fest', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger price_options_sold_guard
  before update on app.price_options
  for each row execute function app.price_options_sold_guard();

-- Schneller Nachweis, ob eine Preisoption verkauft ist.
create index if not exists order_items_price_option_idx on app.order_items (price_option_id);
