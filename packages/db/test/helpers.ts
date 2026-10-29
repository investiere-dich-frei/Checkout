import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "../src/migrate.ts";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export interface TestDb {
  pool: pg.Pool;
  url: string;
  drop(): Promise<void>;
}

/** Legt eine frische Datenbank an und spielt alle Migrationen ein. */
export async function createTestDb(): Promise<TestDb> {
  const name = `idf_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }

  return {
    pool,
    url: url.toString(),
    async drop() {
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database ${name} with (force)`);
      await a.end();
    },
  };
}

export interface Fixture {
  companyId: string;
  customerId: string;
  orderId: string;
}

/** Gesellschaft mit Nummernkreis ab startNumber, ein Kunde, eine Bestellung. */
export async function seed(db: pg.Pool, startNumber = 7981): Promise<Fixture> {
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].id as string;
  const companyId = await q(
    `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
  );
  await db.query(`insert into app.invoice_number_series (company_id, next_value) values ($1, $2)`, [
    companyId,
    startNumber,
  ]);
  const customerId = await q(
    `insert into app.customers (kind, first_name, last_name, email, country) values ('privat', 'Max', 'Muster', 'max@example.org', 'DE') returning id`,
  );
  const legal = [];
  for (const kind of ["agb", "datenschutz", "widerruf"]) {
    legal.push(
      await q(
        `insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`,
        [kind],
      ),
    );
  }
  const orderId = await q(
    `insert into app.orders (company_id, customer_id, status, total_gross_cents, agb_version_id, privacy_version_id, withdrawal_version_id)
     values ($1, $2, 'bezahlt', 11900, $3, $4, $5) returning id`,
    [companyId, customerId, ...legal],
  );
  return { companyId, customerId, orderId };
}

export interface InvoiceInput {
  kind?: "rechnung" | "storno" | "korrektur";
  correctsInvoiceId?: string;
  netCents?: number;
  taxRateBp?: number;
}

/** Stellt eine Rechnung mit einer Position aus, Kopf und Position in derselben Transaktion. */
export async function issueInvoice(
  client: pg.ClientBase,
  f: Fixture,
  input: InvoiceInput = {},
): Promise<{ id: string; invoice_number: string; number_seq: string }> {
  const net = input.netCents ?? 10000;
  const rate = input.taxRateBp ?? 1900;
  const tax = Math.round((net * rate) / 10000);
  const { rows } = await client.query(
    `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
       customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency,
       net_cents, tax_cents, gross_cents)
     values ($1, 0, '', $2, $3, $4, $5, '{}', '{}', current_date, current_date, current_date, 'EUR', $6, $7, $8)
     returning id, invoice_number, number_seq`,
    [f.companyId, input.kind ?? "rechnung", input.correctsInvoiceId ?? null, f.orderId, f.customerId, net, tax, net + tax],
  );
  const inv = rows[0];
  await client.query(
    `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
     values ($1, 1, 'Coaching', 1, $2, $2, $3, $4, $5, $6)`,
    [inv.id, net, rate, tax, net + tax, rate === 0 ? "Steuerfrei nach § 4 Nr. 21 UStG" : null],
  );
  return inv;
}

/** Führt fn in einer Transaktion aus und committet. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
