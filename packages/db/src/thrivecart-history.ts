import type pg from "pg";

/**
 * Übernahme der Altdaten aus Thrivecart: Kunden, Einmalkäufe, Abos und Raten,
 * Zahlungsereignisse und Rechnungen.
 *
 * Quelle ist der Supabase-Spiegel der Thrivecart-Daten. Das Programm liest direkt aus
 * der Quelldatenbank und schreibt in die Zieldatenbank; Kundendaten landen dabei in
 * keiner Zwischendatei. Der Import ist wiederholbar, solange Thrivecart parallel läuft:
 * Neues kommt dazu, Status von Käufen und Abos werden fortgeschrieben, archivierte
 * Belege bleiben unverändert.
 *
 * Zeitangaben im Spiegel haben keine Zeitzone; sie werden als UTC gelesen.
 */

export const HISTORY_ACTOR = "system:thrivecart-altdaten";

/** Ab diesem Tag (Europe/Berlin) stellt die Investiere Dich Frei GmbH aus, vorher die ECB Holding GmbH. */
export const ISSUER_CHANGE_DAY = "2025-09-23";
export const ISSUER_BEFORE = "ECB Holding GmbH";
export const ISSUER_AFTER = "Investiere Dich Frei GmbH";

export interface HistoryStats {
  customers: number;
  invoices: number;
  orders: number;
  subscriptions: number;
  events: number;
  /** Rechnungsnummern zwischen 1 und der höchsten Nummer, die im Spiegel fehlen. */
  missingInvoiceNumbers: number[];
}

type Row = Record<string, unknown>;

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** Zeitstempel aus dem Spiegel als ISO-String in UTC; leer bleibt null. */
export function toUtc(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const m = TIMESTAMP.exec(String(value));
  if (!m) throw new Error(`Unbekanntes Datumsformat: ${JSON.stringify(value)}`);
  return `${m[1]}T${m[2]}Z`;
}

export function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Keine ganze Zahl: ${JSON.stringify(value)}`);
  return n;
}

/** Kalendertag in Europe/Berlin. */
function berlinDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(iso));
}

export function issuerFor(isoTimestamp: string): string {
  return berlinDay(isoTimestamp) < ISSUER_CHANGE_DAY ? ISSUER_BEFORE : ISSUER_AFTER;
}

/** Liest alle benötigten Tabellen aus dem Spiegel. Das Schema ist für Tests wählbar. */
export async function readSource(source: pg.ClientBase, schema = "public") {
  const s = (t: string) => `${source.escapeIdentifier(schema)}.${source.escapeIdentifier(t)}`;
  const q = async (sql: string) => (await source.query<Row>(sql)).rows;
  return {
    customers: await q(`select c.*, to_jsonb(c) as source_row from ${s("tc_customers")} c order by c.sync_timestamp nulls first`),
    purchases: await q(`select p.*, to_jsonb(p) as source_row from ${s("tc_purchases")} p order by p.orderid`),
    subscriptions: await q(`select x.*, to_jsonb(x) as source_row from ${s("tc_subscriptions")} x order by x.subscription_id`),
    events: await q(`select e.*, to_jsonb(e) as source_row from ${s("tc_events")} e order by e.event_id`),
  };
}

export type SourceData = Awaited<ReturnType<typeof readSource>>;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Schreibt die Altdaten. Läuft in der Transaktion des Aufrufers. */
export async function importHistory(target: pg.ClientBase, data: SourceData): Promise<HistoryStats> {
  await target.query(`select set_config('app.actor', $1, true)`, [HISTORY_ACTOR]);

  // Kunden: eine Zeile je Thrivecart-Kunde. Bei doppelten E-Mails gilt der zuletzt synchronisierte.
  const customers = data.customers.map((c) => {
    const company = text(c.company);
    return {
      source_ref: String(c.id),
      kind: company ? "unternehmen" : "privat",
      first_name: text(c.first_name),
      last_name: text(c.last_name),
      company_name: company,
      email: String(c.email ?? "").trim(),
      street: text(c.address_line1),
      postal_code: text(c.address_zip),
      city: text(c.address_city),
      // Unbekanntes Land: XX. Kommt im Spiegel nur vereinzelt vor.
      country: (text(c.address_country) ?? "XX").toUpperCase().slice(0, 2),
      stripe_customer_id: text(c.stripe_id),
      hubspot_contact_id: text(c.hubspot_id),
    };
  });
  const customerRes = await target.query(
    `insert into app.customers as t (source, source_ref, kind, first_name, last_name, company_name, email, street,
       postal_code, city, country, stripe_customer_id, hubspot_contact_id)
     select 'thrivecart', r.source_ref, r.kind, r.first_name, r.last_name, r.company_name, r.email, r.street,
            r.postal_code, r.city, r.country, r.stripe_customer_id, r.hubspot_contact_id
       from jsonb_to_recordset($1::jsonb) as r(source_ref text, kind text, first_name text, last_name text,
            company_name text, email text, street text, postal_code text, city text, country text,
            stripe_customer_id text, hubspot_contact_id text)
     on conflict (source, source_ref) do update set
       kind = excluded.kind, first_name = excluded.first_name, last_name = excluded.last_name,
       company_name = excluded.company_name, email = excluded.email, street = excluded.street,
       postal_code = excluded.postal_code, city = excluded.city, country = excluded.country,
       stripe_customer_id = excluded.stripe_customer_id, hubspot_contact_id = excluded.hubspot_contact_id
     where (t.kind, t.first_name, t.last_name, t.company_name, t.email, t.street, t.postal_code, t.city, t.country,
            t.stripe_customer_id, t.hubspot_contact_id)
       is distinct from (excluded.kind, excluded.first_name, excluded.last_name, excluded.company_name, excluded.email,
            excluded.street, excluded.postal_code, excluded.city, excluded.country,
            excluded.stripe_customer_id, excluded.hubspot_contact_id)`,
    [JSON.stringify(customers)],
  );

  // E-Mail → Kunde, der zuletzt synchronisierte gewinnt (Liste ist danach sortiert).
  const { rows: idRows } = await target.query<{ source_ref: string; id: string }>(
    `select source_ref, id from app.customers where source = 'thrivecart'`,
  );
  const idByRef = new Map(idRows.map((r) => [r.source_ref, r.id]));
  const customerByEmail = new Map<string, string>();
  for (const c of customers) customerByEmail.set(c.email.toLowerCase(), idByRef.get(c.source_ref)!);
  const customerFor = (email: unknown) => customerByEmail.get(String(email ?? "").trim().toLowerCase()) ?? null;

  const purchases = data.purchases.map((p) => ({
    order_id: toInt(p.orderid)!,
    invoice_number: toInt(p.invoice_id)!,
    customer_id: customerFor(p.email),
    email: String(p.email ?? "").trim(),
    ordered_at: toUtc(p.date)!,
    thrivecart_product_id: toInt(p.item_id),
    item_name: text(p.item_name),
    pricing_option_id: text(p.item_pricing_option_id),
    pricing_option_name: text(p.item_pricing_option_name),
    processor: text(p.processor),
    gross_cents: toInt(p.amount)!,
    net_cents: toInt(p.net_amount),
    status: text(p.status) ?? "unbekannt",
    transaction_id: text(p.transaction_id),
    source_row: p.source_row,
  }));

  // Erste Zahlung je Abo aus den Ereignissen, für den Rechnungsbetrag.
  const firstCharge = new Map<number, number>();
  for (const e of data.events) {
    const sub = toInt(e.subscription_id);
    if (sub !== null && String(e.event_type) === "charge" && !firstCharge.has(sub)) firstCharge.set(sub, toInt(e.amount) ?? 0);
  }

  const subscriptions = data.subscriptions.map((x) => ({
    subscription_id: toInt(x.subscription_id)!,
    order_id: toInt(x.order_id),
    invoice_number: toInt(x.invoice_id),
    customer_id: customerFor(x.email),
    email: String(x.email ?? "").trim(),
    status: text(x.status) ?? "unbekannt",
    processor: text(x.processor),
    remote_subscription_id: text(x.remote_subscription_id),
    frequency: text(x.frequency),
    currency: (text(x.currency) ?? "EUR").toUpperCase(),
    amount_cents: toInt(x.amount),
    payments_made: toInt(x.payments),
    payments_remaining: toInt(x.payments_remaining),
    total_paid_cents: toInt(x.total_paid),
    started_at: toUtc(x.date_started),
    last_payment_at: toUtc(x.last_payment),
    next_payment_at: toUtc(x.next_payment),
    thrivecart_product_id: toInt(x.item_id),
    source_row: x.source_row,
  }));

  // Rechnungen: eine je Nummer, aus Einmalkäufen und Abos zusammengeführt.
  const invoices = new Map<number, { invoice_number: number; issuer_name: string; issued_at: string; currency: string; gross_cents: number | null; net_cents: number | null; tax_cents: number | null; source_kind: string }>();
  for (const p of purchases) {
    const known = invoices.get(p.invoice_number);
    if (known) {
      // Zwei Käufe auf einer Rechnung: Beträge addieren, frühestes Datum gilt.
      known.gross_cents = (known.gross_cents ?? 0) + p.gross_cents;
      known.net_cents = known.net_cents === null || p.net_cents === null ? null : known.net_cents + p.net_cents;
      known.tax_cents = known.net_cents === null ? null : known.gross_cents - known.net_cents;
      if (p.ordered_at < known.issued_at) known.issued_at = p.ordered_at;
      continue;
    }
    invoices.set(p.invoice_number, {
      invoice_number: p.invoice_number,
      issuer_name: issuerFor(p.ordered_at),
      issued_at: p.ordered_at,
      currency: "EUR",
      gross_cents: p.gross_cents,
      net_cents: p.net_cents,
      tax_cents: p.net_cents === null ? null : p.gross_cents - p.net_cents,
      source_kind: "kauf",
    });
  }
  for (const x of subscriptions) {
    if (x.invoice_number === null || x.started_at === null || invoices.has(x.invoice_number)) continue;
    invoices.set(x.invoice_number, {
      invoice_number: x.invoice_number,
      issuer_name: issuerFor(x.started_at),
      issued_at: x.started_at,
      currency: x.currency,
      gross_cents: firstCharge.get(x.subscription_id) ?? null,
      net_cents: null,
      tax_cents: null,
      source_kind: "abo",
    });
  }

  const invoiceRes = await target.query(
    `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, gross_cents, net_cents, tax_cents, source_kind)
     select * from jsonb_to_recordset($1::jsonb) as r(invoice_number bigint, issuer_name text, issued_at timestamptz,
            currency text, gross_cents bigint, net_cents bigint, tax_cents bigint, source_kind text)
     on conflict (invoice_number) do nothing`,
    [JSON.stringify([...invoices.values()])],
  );

  const orderRes = await target.query(
    `insert into legacy.thrivecart_orders as t (order_id, invoice_number, customer_id, email, ordered_at, thrivecart_product_id,
       product_id, item_name, pricing_option_id, pricing_option_name, processor, currency, gross_cents, net_cents, status,
       transaction_id, source_row)
     select r.order_id, r.invoice_number, r.customer_id, r.email, r.ordered_at, r.thrivecart_product_id, p.id, r.item_name,
            r.pricing_option_id, r.pricing_option_name, r.processor, 'EUR', r.gross_cents, r.net_cents, r.status,
            r.transaction_id, r.source_row
       from jsonb_to_recordset($1::jsonb) as r(order_id bigint, invoice_number bigint, customer_id uuid, email text,
            ordered_at timestamptz, thrivecart_product_id bigint, item_name text, pricing_option_id text,
            pricing_option_name text, processor text, gross_cents bigint, net_cents bigint, status text,
            transaction_id text, source_row jsonb)
       left join app.products p on p.thrivecart_product_id = r.thrivecart_product_id
     on conflict (order_id) do update set
       status = excluded.status, source_row = excluded.source_row,
       customer_id = excluded.customer_id, product_id = excluded.product_id
     where (t.status, t.source_row, t.customer_id, t.product_id)
           is distinct from (excluded.status, excluded.source_row, excluded.customer_id, excluded.product_id)`,
    [JSON.stringify(purchases)],
  );

  const subRes = await target.query(
    `insert into legacy.thrivecart_subscriptions as t (subscription_id, order_id, invoice_number, customer_id, email, status,
       processor, remote_subscription_id, frequency, currency, amount_cents, payments_made, payments_remaining,
       total_paid_cents, started_at, last_payment_at, next_payment_at, thrivecart_product_id, product_id, source_row)
     select r.subscription_id, r.order_id, r.invoice_number, r.customer_id, r.email, r.status, r.processor,
            r.remote_subscription_id, r.frequency, r.currency, r.amount_cents, r.payments_made, r.payments_remaining,
            r.total_paid_cents, r.started_at, r.last_payment_at, r.next_payment_at, r.thrivecart_product_id, p.id, r.source_row
       from jsonb_to_recordset($1::jsonb) as r(subscription_id bigint, order_id bigint, invoice_number bigint,
            customer_id uuid, email text, status text, processor text, remote_subscription_id text, frequency text,
            currency text, amount_cents bigint, payments_made integer, payments_remaining integer,
            total_paid_cents bigint, started_at timestamptz, last_payment_at timestamptz, next_payment_at timestamptz,
            thrivecart_product_id bigint, source_row jsonb)
       left join app.products p on p.thrivecart_product_id = r.thrivecart_product_id
     on conflict (subscription_id) do update set
       customer_id = excluded.customer_id, email = excluded.email, status = excluded.status,
       remote_subscription_id = excluded.remote_subscription_id, amount_cents = excluded.amount_cents,
       payments_made = excluded.payments_made, payments_remaining = excluded.payments_remaining,
       total_paid_cents = excluded.total_paid_cents, last_payment_at = excluded.last_payment_at,
       next_payment_at = excluded.next_payment_at, product_id = excluded.product_id,
       source_row = excluded.source_row, updated_at = now()
     where t.source_row is distinct from excluded.source_row
        or (t.customer_id, t.product_id) is distinct from (excluded.customer_id, excluded.product_id)`,
    [JSON.stringify(subscriptions)],
  );

  const events = data.events.map((e) => ({
    event_id: toInt(e.event_id)!,
    order_id: toInt(e.order_id),
    invoice_number: toInt(e.invoice_id),
    subscription_id: toInt(e.subscription_id),
    event_type: text(e.event_type) ?? "unbekannt",
    occurred_at: toUtc(e.date)!,
    amount_cents: toInt(e.amount),
    processor: text(e.processor),
    transaction_id: text(e.transaction_id),
    source_row: e.source_row,
  }));
  const eventRes = await target.query(
    `insert into legacy.thrivecart_events (event_id, order_id, invoice_number, subscription_id, event_type, occurred_at,
       amount_cents, processor, transaction_id, source_row)
     select * from jsonb_to_recordset($1::jsonb) as r(event_id bigint, order_id bigint, invoice_number bigint,
            subscription_id bigint, event_type text, occurred_at timestamptz, amount_cents bigint, processor text,
            transaction_id text, source_row jsonb)
     on conflict (event_id) do nothing`,
    [JSON.stringify(events)],
  );

  const { rows: gaps } = await target.query<{ n: string }>(
    `select g::text n from generate_series(1, (select coalesce(max(invoice_number), 0) from legacy.thrivecart_invoices)) g
      where not exists (select 1 from legacy.thrivecart_invoices i where i.invoice_number = g) order by g`,
  );

  return {
    customers: customerRes.rowCount ?? 0,
    invoices: invoiceRes.rowCount ?? 0,
    orders: orderRes.rowCount ?? 0,
    subscriptions: subRes.rowCount ?? 0,
    events: eventRes.rowCount ?? 0,
    missingInvoiceNumbers: gaps.map((g) => Number(g.n)),
  };
}
