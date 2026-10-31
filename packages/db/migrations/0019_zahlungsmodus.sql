-- 0019 Test- und Live-Zahlungen trennen.
--
-- Eine Testzahlung (Stripe-Testschlüssel, PayPal-Sandbox) darf in der echten Datenbank
-- nie zu einer Rechnung führen: Sie belegte eine Nummer im lückenlosen Kreis und ließe
-- sich nicht zurücknehmen. Umgekehrt gehört echtes Geld nicht in eine Testdatenbank.
-- Jede Gesellschaft trägt deshalb ihren Zahlungsmodus. Voreinstellung ist „live“; eine
-- Testdatenbank wird mit `db:configure payments-mode test` umgestellt.

alter table app.companies
  add column payments_mode text not null default 'live' check (payments_mode in ('live', 'test'));
