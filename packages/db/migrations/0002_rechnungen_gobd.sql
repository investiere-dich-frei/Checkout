-- 0002 Rechnungen nach GoBD:
--  * Nummern vergibt ausschließlich die Datenbank, lückenlos je Gesellschaft.
--  * Ausgestellte Rechnungen und ihre Positionen sind unveränderbar.
--    Korrekturen nur über Storno- oder Korrekturrechnung mit Verweis.
--  * Summen der Positionen müssen zum Rechnungskopf passen (Prüfung beim Commit).

create or replace function app.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'GoBD: % auf %.% ist nicht erlaubt', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

-- Nummernkreis je Gesellschaft. next_value ist die nächste zu vergebende Nummer.
-- Die Zeilensperre beim UPDATE serialisiert parallele Ausstellungen; ein Rollback
-- setzt den Zähler mit zurück, dadurch entstehen keine Lücken.
create table app.invoice_number_series (
  company_id uuid primary key references app.companies (id),
  prefix     text not null default '',
  next_value bigint not null check (next_value > 0)
);

create trigger invoice_number_series_no_delete
  before delete on app.invoice_number_series
  for each row execute function app.forbid_change();

-- Der Zähler darf nur weiterlaufen, nie zurück oder springen.
create or replace function app.invoice_number_series_guard() returns trigger
language plpgsql as $$
begin
  if new.company_id <> old.company_id or new.prefix <> old.prefix then
    raise exception 'GoBD: Nummernkreis darf nicht umgestellt werden' using errcode = 'P0001';
  end if;
  if new.next_value <> old.next_value + 1 then
    raise exception 'GoBD: Nummernkreis darf nur um 1 weiterlaufen' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger invoice_number_series_guard
  before update on app.invoice_number_series
  for each row execute function app.invoice_number_series_guard();

create table app.invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references app.companies (id),
  number_seq          bigint not null,
  invoice_number      text not null,
  kind                text not null check (kind in ('rechnung', 'storno', 'korrektur')),
  corrects_invoice_id uuid references app.invoices (id),
  order_id            uuid not null references app.orders (id),
  customer_id         uuid not null references app.customers (id),
  -- Stand von Kunde und Gesellschaft zum Ausstellungszeitpunkt.
  customer_snapshot   jsonb not null,
  company_snapshot    jsonb not null,
  issue_date          date not null,
  service_date_from   date not null,
  service_date_to     date not null,
  currency            char(3) not null,
  net_cents           bigint not null,
  tax_cents           bigint not null,
  gross_cents         bigint not null,
  note                text,
  -- Nur ein einziges Mal setzbar, sobald das PDF im WORM-Speicher liegt.
  pdf_sha256          bytea,
  pdf_storage_key     text,
  created_txid        xid8 not null default pg_current_xact_id(),
  created_at          timestamptz not null default now(),
  unique (company_id, number_seq),
  unique (company_id, invoice_number),
  check (net_cents + tax_cents = gross_cents),
  check (service_date_from <= service_date_to),
  check ((kind = 'rechnung') = (corrects_invoice_id is null)),
  check (kind <> 'rechnung' or gross_cents >= 0),
  check (kind <> 'storno' or gross_cents <= 0),
  check ((pdf_sha256 is null) = (pdf_storage_key is null))
);
create unique index invoices_one_storno_idx on app.invoices (corrects_invoice_id) where kind = 'storno';
create index invoices_order_idx on app.invoices (order_id);

create table app.invoice_items (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references app.invoices (id),
  position           integer not null check (position > 0),
  description        text not null,
  quantity           integer not null check (quantity <> 0),
  unit_net_cents     bigint not null,
  net_cents          bigint not null,
  -- Steuersatz in Basispunkten: 1900 = 19 %.
  tax_rate_bp        integer not null check (tax_rate_bp between 0 and 10000),
  tax_cents          bigint not null,
  gross_cents        bigint not null,
  -- Pflichtangabe bei Steuerbefreiung, z. B. "Steuerfrei nach § 4 Nr. 21 UStG".
  tax_exemption_note text,
  unique (invoice_id, position),
  check (net_cents = unit_net_cents * quantity),
  check (net_cents + tax_cents = gross_cents),
  check (tax_rate_bp > 0 or tax_cents = 0),
  check (tax_rate_bp > 0 or tax_exemption_note is not null)
);

-- Vergibt die nächste Nummer. Nur innerhalb einer Transaktion sinnvoll,
-- die die Rechnung auch anlegt.
create or replace function app.next_invoice_number(p_company_id uuid, out seq bigint, out prefix text)
language plpgsql as $$
begin
  update app.invoice_number_series s
     set next_value = s.next_value + 1
   where s.company_id = p_company_id
  returning s.next_value - 1, s.prefix into seq, prefix;
  if seq is null then
    raise exception 'Kein Nummernkreis für Gesellschaft %', p_company_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function app.invoices_before_insert() returns trigger
language plpgsql as $$
declare
  v_seq    bigint;
  v_prefix text;
  v_orig   app.invoices;
begin
  -- Werte aus der Anwendung werden ignoriert: Nummer und Transaktion setzt die Datenbank.
  select n.seq, n.prefix into v_seq, v_prefix from app.next_invoice_number(new.company_id) n;
  new.number_seq     := v_seq;
  new.invoice_number := v_prefix || v_seq::text;
  new.created_txid   := pg_current_xact_id();
  new.created_at     := now();
  new.pdf_sha256     := null;
  new.pdf_storage_key := null;

  if new.corrects_invoice_id is not null then
    select * into v_orig from app.invoices where id = new.corrects_invoice_id;
    if v_orig.company_id <> new.company_id then
      raise exception 'GoBD: Storno/Korrektur muss bei derselben Gesellschaft liegen' using errcode = 'P0001';
    end if;
    if v_orig.kind <> 'rechnung' then
      raise exception 'GoBD: Storno/Korrektur nur auf eine Ausgangsrechnung' using errcode = 'P0001';
    end if;
    if new.kind = 'storno' and new.gross_cents <> -v_orig.gross_cents then
      raise exception 'GoBD: Storno muss den vollen Betrag der Rechnung % umkehren', v_orig.invoice_number
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_before_insert
  before insert on app.invoices
  for each row execute function app.invoices_before_insert();

-- Einzige erlaubte Änderung: PDF-Prüfsumme und Speicherort einmalig nachtragen.
create or replace function app.invoices_before_update() returns trigger
language plpgsql as $$
begin
  if old.pdf_sha256 is null
     and new.pdf_sha256 is not null
     and (to_jsonb(new) - 'pdf_sha256' - 'pdf_storage_key') = (to_jsonb(old) - 'pdf_sha256' - 'pdf_storage_key') then
    return new;
  end if;
  raise exception 'GoBD: Rechnung % ist ausgestellt und unveränderbar', old.invoice_number
    using errcode = 'P0001';
end;
$$;

create trigger invoices_before_update
  before update on app.invoices
  for each row execute function app.invoices_before_update();

create trigger invoices_no_delete
  before delete on app.invoices
  for each row execute function app.forbid_change();

create trigger invoices_no_truncate
  before truncate on app.invoices
  for each statement execute function app.forbid_change();

-- Positionen nur in derselben Transaktion, in der die Rechnung entsteht.
create or replace function app.invoice_items_before_insert() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from app.invoices i
     where i.id = new.invoice_id and i.created_txid = pg_current_xact_id()
  ) then
    raise exception 'GoBD: Positionen können einer ausgestellten Rechnung nicht nachträglich hinzugefügt werden'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger invoice_items_before_insert
  before insert on app.invoice_items
  for each row execute function app.invoice_items_before_insert();

create trigger invoice_items_no_update
  before update or delete on app.invoice_items
  for each row execute function app.forbid_change();

create trigger invoice_items_no_truncate
  before truncate on app.invoice_items
  for each statement execute function app.forbid_change();

-- Beim Commit: mindestens eine Position, Summen stimmen mit dem Kopf überein.
create or replace function app.invoices_check_totals() returns trigger
language plpgsql as $$
declare
  v_count bigint;
  v_net   bigint;
  v_tax   bigint;
  v_gross bigint;
  v_inv   app.invoices;
begin
  select * into v_inv from app.invoices where id = new.id;
  select count(*), coalesce(sum(net_cents), 0), coalesce(sum(tax_cents), 0), coalesce(sum(gross_cents), 0)
    into v_count, v_net, v_tax, v_gross
    from app.invoice_items where invoice_id = new.id;
  if v_count = 0 then
    raise exception 'GoBD: Rechnung % hat keine Positionen', v_inv.invoice_number using errcode = 'P0001';
  end if;
  if (v_net, v_tax, v_gross) <> (v_inv.net_cents, v_inv.tax_cents, v_inv.gross_cents) then
    raise exception 'GoBD: Summen der Rechnung % passen nicht zu den Positionen', v_inv.invoice_number
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger invoices_check_totals
  after insert on app.invoices
  deferrable initially deferred
  for each row execute function app.invoices_check_totals();

-- Rechtstexte: einmal veröffentlicht, nie geändert.
create trigger legal_text_versions_immutable
  before update or delete on app.legal_text_versions
  for each row execute function app.forbid_change();

-- Bestellungen und Zahlungen dürfen ihren Status ändern, aber nicht verschwinden.
create trigger orders_no_delete
  before delete on app.orders
  for each row execute function app.forbid_change();

create trigger order_items_no_delete
  before delete on app.order_items
  for each row execute function app.forbid_change();

create trigger payments_no_delete
  before delete on app.payments
  for each row execute function app.forbid_change();

create trigger orders_no_truncate before truncate on app.orders
  for each statement execute function app.forbid_change();
create trigger payments_no_truncate before truncate on app.payments
  for each statement execute function app.forbid_change();
