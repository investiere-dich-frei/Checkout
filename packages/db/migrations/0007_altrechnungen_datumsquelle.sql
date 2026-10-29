-- 0007 Herkunft des Rechnungsdatums bei Thrivecart-Altrechnungen.
--
-- Bei manchen Abos fehlt im Spiegel das Startdatum. Damit ihre Rechnungsnummer
-- trotzdem archiviert wird (keine weiteren Lücken), nimmt der Import ein
-- Ersatzdatum und vermerkt hier, woher es stammt:
--   kauf             Datum des Kaufs (Einmalkauf)
--   abo_start        Startdatum des Abos
--   ersatz_ereignis  frühestes Zahlungsereignis zu Abo, Bestellung oder Rechnung
--   ersatz_kauf      Kaufdatum der zugehörigen Bestellung
--   ersatz_zahlung   letzte bekannte Zahlung des Abos

alter table legacy.thrivecart_invoices
  add column issued_at_source text not null default 'kauf'
    check (issued_at_source in ('kauf', 'abo_start', 'ersatz_ereignis', 'ersatz_kauf', 'ersatz_zahlung'));

update legacy.thrivecart_invoices set issued_at_source = 'abo_start' where source_kind = 'abo';
