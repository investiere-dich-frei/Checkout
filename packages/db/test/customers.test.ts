import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { resendInvoiceMail } from "../src/customer-mails.ts";
import { customerDetail, listCustomers, searchLegacyOrders, updateCustomerContact } from "../src/customers.ts";
import { createTestDb, issueInvoice, seed, tx, type Fixture, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft und Kundinnen, keine echten Daten.
describe("Verwaltung: Kunden", () => {
  let db: TestDb;
  let f: Fixture;
  let second: string;
  const admin: SessionUser = { id: "00000000-0000-0000-0000-000000000001", email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
  const pruefer: SessionUser = { ...admin, role: "pruefer" };
  const vertrieb: SessionUser = { ...admin, role: "vertrieb", salesCode: "v" };

  before(async () => {
    db = await createTestDb();
    f = await seed(db.pool, 1);
    await db.pool.query(`update app.customers set street = 'Altweg 1', postal_code = '10115', city = 'Berlin' where id = $1`, [f.customerId]);
    // Zweiter Datensatz derselben Kundin (spätere Bestellung), andere Schreibweise der Adresse.
    second = (
      await db.pool.query(
        `insert into app.customers (kind, first_name, last_name, email, country) values ('privat', 'Max', 'Muster', 'MAX@example.org', 'DE') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(`insert into app.customers (kind, last_name, email, country) values ('privat', 'Andere', 'andere@example.org', 'AT')`);
    // Altdaten aus Thrivecart, über die E-Mail zugeordnet.
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, gross_cents, source_kind)
       values (4711, 'Test GmbH', '2025-03-01', 'EUR', 49700, 'kauf'), (4712, 'Test GmbH', '2025-05-01', 'EUR', 9900, 'abo')`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_orders (order_id, invoice_number, email, ordered_at, item_name, currency, gross_cents, status, source_row)
       values (900001, 4711, 'max@example.org', '2025-03-01', 'Masterclass', 'EUR', 49700, 'paid', '{}')`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, email, status, frequency, currency, amount_cents, payments_made, source_row)
       values (800001, 4712, 'max@example.org', 'active', 'month', 'EUR', 9900, 5, '{}')`,
    );
  });
  after(() => db.drop());

  it("fasst Datensätze über die E-Mail zusammen und zeigt Thrivecart-Käufe", async () => {
    const all = await listCustomers(db.pool, admin);
    assert.equal(all.length, 2);
    const max = all.find((c) => c.email.toLowerCase() === "max@example.org")!;
    assert.equal(max.orders, 1);
    assert.equal(max.legacyOrders, 1);
    assert.deepEqual((await listCustomers(db.pool, pruefer, { search: "andere" })).map((c) => c.country), ["AT"]);
    assert.deepEqual(await listCustomers(db.pool, vertrieb), []);

    const d = (await customerDetail(db.pool, admin, second))!;
    assert.equal(d.recordCount, 2);
    assert.equal(d.orders.length, 1);
    assert.equal(d.legacyOrders.length, 1);
    assert.equal(d.legacySubscriptions[0].status, "active");
    assert.equal(await customerDetail(db.pool, vertrieb, second), null);

    assert.equal((await searchLegacyOrders(db.pool, admin, "4711")).length, 1);
    assert.equal((await searchLegacyOrders(db.pool, admin, "masterclass"))[0].customer_id !== null, true);
    assert.deepEqual(await searchLegacyOrders(db.pool, vertrieb, "4711"), []);
  });

  it("ändert Kontaktdaten aller Datensätze, Rechnungen behalten ihren Stand", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    const before = (await db.pool.query(`select customer_snapshot from app.invoices where id = $1`, [inv.id])).rows[0].customer_snapshot;

    await assert.rejects(tx(db.pool, (c) => updateCustomerContact(c, pruefer, f.customerId, { email: "max@example.org", last_name: "Muster" })), /Berechtigung/);
    await assert.rejects(tx(db.pool, (c) => updateCustomerContact(c, admin, f.customerId, { email: "kaputt", last_name: "Muster" })), /E-Mail/);
    await assert.rejects(
      tx(db.pool, (c) => updateCustomerContact(c, admin, f.customerId, { email: "andere@example.org", last_name: "Muster" })),
      /andere Kundin/,
    );

    const n = await tx(db.pool, async (c) => {
      await c.query(`select set_config('app.actor', 'user:test', true)`);
      return updateCustomerContact(c, admin, f.customerId, {
        first_name: "Max",
        last_name: "Muster",
        email: "max.neu@example.org",
        street: "Neuweg 2",
        postal_code: "20095",
        city: "Hamburg",
      });
    });
    assert.equal(n, 2);
    const rows = (await db.pool.query(`select email, street, country from app.customers where id = any($1)`, [[f.customerId, second]])).rows;
    assert.ok(rows.every((r) => r.email === "max.neu@example.org" && r.street === "Neuweg 2" && r.country === "DE"));
    const after = (await db.pool.query(`select customer_snapshot from app.invoices where id = $1`, [inv.id])).rows[0].customer_snapshot;
    assert.deepEqual(after, before);
    const audit = (await db.pool.query(`select count(*)::int n from app.audit_log where table_name = 'customers' and actor = 'user:test'`)).rows[0].n;
    assert.equal(audit, 2);
  });

  it("schickt eine Rechnung erneut, wahlweise an eine andere Adresse", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    const id = await tx(db.pool, (c) => resendInvoiceMail(c, inv.id, "neu@example.org"));
    const mail = (await db.pool.query(`select purpose, to_address, related_id, subject from app.mail_outbox where id = $1`, [id])).rows[0];
    assert.equal(mail.purpose, "rechnung");
    assert.equal(mail.to_address, "neu@example.org");
    assert.equal(mail.related_id, inv.id);
    await assert.rejects(tx(db.pool, (c) => resendInvoiceMail(c, inv.id, "kaputt")), /gültige/);
  });
});
