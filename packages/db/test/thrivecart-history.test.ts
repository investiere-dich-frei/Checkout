import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { importHistory, issuerFor, readSource, toUtc } from "../src/thrivecart-history.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Nachbau der Spiegel-Tabellen mit ausgedachten Daten, keine echten Kunden.
const SOURCE_DDL = `
create schema src;
create table src.tc_customers (id uuid primary key, company text, first_name text, last_name text, email text,
  address_line1 text, address_city text, address_zip text, address_country text, stripe_id text, hubspot_id text,
  sync_timestamp timestamptz);
create table src.tc_purchases (orderid bigint, invoice_id bigint, email text, date text, item_id bigint, item_name text,
  item_pricing_option_id text, item_pricing_option_name text, processor text, amount bigint, net_amount bigint,
  status text, transaction_id text);
create table src.tc_subscriptions (subscription_id bigint, order_id bigint, invoice_id bigint, email text, status text,
  processor text, remote_subscription_id text, frequency text, currency text, amount text, payments bigint,
  payments_remaining text, total_paid text, last_payment text, date_started text, next_payment text, item_id bigint);
create table src.tc_events (event_id bigint, order_id bigint, invoice_id bigint, subscription_id bigint, event_type text,
  date timestamptz, amount bigint, processor text, transaction_id text);

insert into src.tc_customers values
  ('00000000-0000-0000-0000-000000000001', null, 'Erika', 'Muster', 'erika@example.org', 'Weg 1', 'Ort', '12345', 'DE', 'cus_1', '101', '2026-01-01'),
  ('00000000-0000-0000-0000-000000000002', 'Firma AG', 'Max', 'Probe', 'max@example.org', 'Gasse 2', 'Wien', '1010', 'AT', null, null, '2026-01-01'),
  ('00000000-0000-0000-0000-000000000003', null, 'Erika', 'Muster', 'Erika@example.org', 'Weg 1', 'Ort', '12345', null, 'cus_2', null, '2026-02-01');
insert into src.tc_purchases values
  (9001, 1, 'erika@example.org', '2025-09-22 21:30:00', 10, 'Kurs', '98921', 'Einmal', 'stripe_v2', 3700, 3109, 'paid', 'ch_1'),
  (9002, 2, 'max@example.org', '2025-09-22 22:30:00', 10, 'Kurs', '98921', 'Einmal', 'paypal_v2', 3700, 3109, 'paid', 'pp_1'),
  (9003, 2, 'max@example.org', '2025-09-22 22:30:00', 11, 'Zusatz', '1', 'Bump', 'paypal_v2', 1000, 1000, 'paid', 'pp_1'),
  (9004, 5, 'unbekannt@example.org', '2026-01-10 10:00:00', 99, 'Altprodukt', '1', 'Einmal', 'thrivepay', 5000, 5000, 'refunded', 'ch_2');
insert into src.tc_subscriptions values
  (7001, 9100, 4, 'erika@example.org', 'active', 'thrivepay', 'sub_1', 'month', 'EUR', '9900', 2, '10', '19800',
   '2026-02-10 10:00:00', '2026-01-10 10:00:00', '2026-03-10 10:00:00', 10);
insert into src.tc_events values
  (1, 9100, 4, 7001, 'charge', '2026-01-10 10:00:00+00', 9900, 'thrivepay', 'ch_10'),
  (2, 9100, 4, 7001, 'rebill', '2026-02-10 10:00:00+00', 9900, 'thrivepay', 'ch_11');
`;

describe("Thrivecart-Altdaten", () => {
  let db: TestDb;

  before(async () => {
    db = await createTestDb();
    await db.pool.query(SOURCE_DDL);
    const company = (
      await db.pool.query(`insert into app.companies (legal_name, street, postal_code, city) values ('T', 'S', '1', 'B') returning id`)
    ).rows[0].id;
    await db.pool.query(
      `insert into app.products (company_id, name, tax_category, thrivecart_product_id) values ($1, 'Kurs', 'standard', 10)`,
      [company],
    );
  });
  after(() => db.drop());

  const run = async () => {
    const c = await db.pool.connect();
    try {
      const data = await readSource(c, "src");
      return await tx(db.pool, (t) => importHistory(t, data));
    } finally {
      c.release();
    }
  };

  it("liest Zeitstempel als UTC und ordnet die ausstellende Gesellschaft nach Berliner Datum zu", () => {
    assert.equal(toUtc("2025-09-22 21:30:00"), "2025-09-22T21:30:00Z");
    // 21:30 UTC ist in Berlin noch der 22.09., 22:30 UTC schon der 23.09.
    assert.equal(issuerFor("2025-09-22T21:30:00Z"), "ECB Holding GmbH");
    assert.equal(issuerFor("2025-09-22T22:30:00Z"), "Investiere Dich Frei GmbH");
  });

  it("übernimmt alles und meldet fehlende Rechnungsnummern", async () => {
    const stats = await run();
    assert.deepEqual(
      { ...stats },
      { customers: 3, invoices: 4, orders: 4, subscriptions: 1, events: 2, missingInvoiceNumbers: [3] },
    );
  });

  it("führt zwei Käufe auf einer Rechnung zusammen und rechnet Abo-Rechnungen aus der Erstzahlung", async () => {
    const { rows } = await db.pool.query(
      `select invoice_number::int n, issuer_name, gross_cents::int g, net_cents::int net, source_kind from legacy.thrivecart_invoices order by 1`,
    );
    assert.deepEqual(rows, [
      { n: 1, issuer_name: "ECB Holding GmbH", g: 3700, net: 3109, source_kind: "kauf" },
      { n: 2, issuer_name: "Investiere Dich Frei GmbH", g: 4700, net: 4109, source_kind: "kauf" },
      { n: 4, issuer_name: "Investiere Dich Frei GmbH", g: 9900, net: null, source_kind: "abo" },
      { n: 5, issuer_name: "Investiere Dich Frei GmbH", g: 5000, net: 5000, source_kind: "kauf" },
    ]);
  });

  it("verknüpft Kunden, Produkte und Stripe-Verweise", async () => {
    const order = (await db.pool.query(
      `select o.product_id is not null has_product, c.stripe_customer_id from legacy.thrivecart_orders o
         join app.customers c on c.id = o.customer_id where o.order_id = 9001`,
    )).rows[0];
    // Bei doppelter E-Mail gilt der zuletzt synchronisierte Kunde.
    assert.deepEqual(order, { has_product: true, stripe_customer_id: "cus_2" });
    const orphan = (await db.pool.query(`select customer_id, product_id from legacy.thrivecart_orders where order_id = 9004`)).rows[0];
    assert.deepEqual(orphan, { customer_id: null, product_id: null });
    const unknownCountry = (await db.pool.query(`select country from app.customers where source_ref = '00000000-0000-0000-0000-000000000003'`)).rows[0];
    assert.equal(unknownCountry.country, "XX");
    const sub = (await db.pool.query(`select remote_subscription_id, payments_remaining from legacy.thrivecart_subscriptions`)).rows[0];
    assert.deepEqual(sub, { remote_subscription_id: "sub_1", payments_remaining: 10 });
  });

  it("ist wiederholbar und schreibt dabei nur Änderungen fort", async () => {
    await db.pool.query(`update src.tc_purchases set status = 'refunded' where orderid = 9001`);
    await db.pool.query(`update src.tc_subscriptions set payments = 3, payments_remaining = '9', total_paid = '29700'`);
    await db.pool.query(`insert into src.tc_events values (3, 9100, 4, 7001, 'rebill', '2026-03-10 10:00:00+00', 9900, 'thrivepay', 'ch_12')`);
    const stats = await run();
    assert.deepEqual({ ...stats }, { customers: 0, invoices: 0, orders: 1, subscriptions: 1, events: 1, missingInvoiceNumbers: [3] });
    const st = (await db.pool.query(`select status from legacy.thrivecart_orders where order_id = 9001`)).rows[0].status;
    assert.equal(st, "refunded");
  });

  it("schützt archivierte Belege", async () => {
    await assert.rejects(db.pool.query(`update legacy.thrivecart_invoices set gross_cents = 1 where invoice_number = 1`), /GoBD/);
    await assert.rejects(db.pool.query(`update legacy.thrivecart_orders set gross_cents = 1 where order_id = 9001`), /GoBD/);
    await assert.rejects(db.pool.query(`update legacy.thrivecart_events set amount_cents = 1 where event_id = 1`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from legacy.thrivecart_orders where order_id = 9001`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from legacy.thrivecart_subscriptions`), /GoBD/);
    // Das PDF darf einmal nachgetragen werden.
    await db.pool.query(`update legacy.thrivecart_invoices set pdf_sha256 = '\\x01', pdf_storage_key = 'tc/1.pdf' where invoice_number = 1`);
    await assert.rejects(db.pool.query(`update legacy.thrivecart_invoices set pdf_storage_key = 'x' where invoice_number = 1`), /GoBD/);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
    const actors = (await db.pool.query(`select distinct actor from app.audit_log where table_name like 'thrivecart_%' order by actor`)).rows;
    assert.deepEqual(actors, [{ actor: "db:postgres" }, { actor: "system:thrivecart-altdaten" }]);
  });
});
