-- Testdaten für die Generalprobe. Keine echten Kundendaten.
-- Aufruf mit -v phase=vorher|nachher: legt je Phase Rechnungen an.

\set ON_ERROR_STOP on

insert into app.companies (id, legal_name, street, postal_code, city)
values ('00000000-0000-0000-0000-000000000001', 'Probe GmbH', 'Teststr. 1', '10115', 'Berlin')
on conflict do nothing;

insert into app.invoice_number_series (company_id, next_value)
values ('00000000-0000-0000-0000-000000000001', 7981)
on conflict do nothing;

insert into app.customers (id, kind, first_name, last_name, email, country)
values ('00000000-0000-0000-0000-000000000002', 'privat', 'Erika', 'Probe', 'probe@example.org', 'DE')
on conflict do nothing;

insert into app.legal_text_versions (id, kind, version, content, valid_from)
values ('00000000-0000-0000-0000-0000000000a1', 'agb', 'probe', 'AGB', now()),
       ('00000000-0000-0000-0000-0000000000a2', 'datenschutz', 'probe', 'Datenschutz', now()),
       ('00000000-0000-0000-0000-0000000000a3', 'widerruf', 'probe', 'Widerruf', now())
on conflict do nothing;

-- Je Aufruf 20 Bestellungen mit Rechnung, jede in eigener Transaktion wie im Betrieb.
select format($f$
begin;
set local app.actor = 'system:backup-probe';
with o as (
  insert into app.orders (company_id, customer_id, status, total_gross_cents, agb_version_id, privacy_version_id, withdrawal_version_id)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'bezahlt', 11900,
          '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')
  returning id
), i as (
  insert into app.invoices (company_id, number_seq, invoice_number, kind, order_id, customer_id, customer_snapshot, company_snapshot,
    issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
  select '00000000-0000-0000-0000-000000000001', 0, '', 'rechnung', o.id, '00000000-0000-0000-0000-000000000002', '{}', '{}',
    current_date, current_date, current_date, 'EUR', 10000, 1900, 11900, %L
  from o returning id
)
insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents)
select i.id, 1, 'Probe', 1, 10000, 10000, 1900, 1900, 11900 from i;
commit;
$f$, :'phase')
from generate_series(1, 20)
\gexec
