import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { rememberPaymentMethod } from "../src/billing.ts";
import { cardChangeTarget, portalEmail, portalLegacySubscriptions, portalOrders, requestPortalLink } from "../src/customer-portal.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkt und Kundinnen, keine echten Daten.
describe("Kundenbereich", () => {
  let db: TestDb;
  let orderId: string;
  let customerId: string;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    const product = await q(`insert into app.products (company_id, name, tax_category, active) values ($1, 'Club', 'standard', false) returning id`, [company]);
    const option = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 10000, 'brutto', 10000, 2, 3, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    customerId = await q(`insert into app.customers (kind, first_name, last_name, email, country) values ('privat', 'Erika', 'Muster', 'Erika@Example.org', 'DE') returning id`);
    orderId = await q(
      `insert into app.orders (company_id, customer_id, status, total_gross_cents, agb_version_id, privacy_version_id, withdrawal_version_id)
       values ($1, $2, 'offen', 30000, $3, $4, $5) returning id`,
      [company, customerId, ...legal],
    );
    const item = await q(`insert into app.order_items (order_id, price_option_id, quantity, amount_cents) values ($1, $2, 1, 30000) returning id`, [orderId, option]);
    for (const [seq, due, status] of [
      [1, "2026-09-01", "offen"],
      [2, "2026-10-01", "fehlgeschlagen"],
      [3, "2026-11-01", "offen"],
    ] as const) {
      await db.pool.query(
        `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents, status) values ($1, $2, $3, $4, 8403, 1597, 10000, $5)`,
        [orderId, item, seq, due, status],
      );
    }
    await rememberPaymentMethod(db.pool, { customerId, provider: "stripe", ref: "pm_alt", providerCustomer: "cus_erika" });
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind) values (1, 'Test GmbH', '2025-01-01', 'EUR', 'abo')`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, email, status, processor, source_row)
       values (1, 1, 'erika@example.org', 'active', 'paypal_v2', '{"item_name": "Altes Abo"}')`,
    );
  });
  after(() => db.drop());

  const linkFrom = async () => {
    const m = await db.pool.query(`select to_address, body_text from app.mail_outbox where purpose = 'kundenbereich' order by created_at desc limit 1`);
    return { to: m.rows[0].to_address as string, token: /\/konto\/([A-Za-z0-9_-]{43})/.exec(m.rows[0].body_text)![1]! };
  };

  it("schickt einen Link nur an bekannte Adressen und höchstens dreimal je Stunde", async () => {
    assert.equal(await tx(db.pool, (c) => requestPortalLink(c, "fremd@example.org", "https://kasse.test")), false);
    assert.equal(await tx(db.pool, (c) => requestPortalLink(c, " ERIKA@example.org ", "https://kasse.test")), true);
    const l = await linkFrom();
    assert.equal(l.to, "erika@example.org");
    assert.equal(await portalEmail(db.pool, l.token), "erika@example.org");
    assert.equal(await portalEmail(db.pool, "x".repeat(43)), null);
    assert.equal(await portalEmail(db.pool, "kurz"), null);
    await tx(db.pool, (c) => requestPortalLink(c, "erika@example.org", "https://kasse.test"));
    await tx(db.pool, (c) => requestPortalLink(c, "erika@example.org", "https://kasse.test"));
    assert.equal(await tx(db.pool, (c) => requestPortalLink(c, "erika@example.org", "https://kasse.test")), false);
    // Aus der Verwaltung gilt die Grenze nicht.
    assert.equal(await tx(db.pool, (c) => requestPortalLink(c, "erika@example.org", "https://kasse.test", "user:test")), true);
  });

  it("abgelaufene Links gelten nicht mehr", async () => {
    const { token } = await linkFrom();
    await db.pool.query(`update app.customer_portal_links set expires_at = now() - interval '1 minute'`);
    assert.equal(await portalEmail(db.pool, token), null);
  });

  it("zeigt Bestellungen, Zahlweg und Thrivecart-Abos", async () => {
    const orders = await portalOrders(db.pool, "erika@example.org");
    assert.equal(orders.length, 1);
    assert.deepEqual([orders[0]!.payment, orders[0]!.canChangeCard, orders[0]!.installments.length], ["stripe", true, 3]);
    const legacy = await portalLegacySubscriptions(db.pool, "erika@example.org");
    assert.deepEqual(legacy.map((l) => l.product), ["Altes Abo"]);
    assert.deepEqual(await portalOrders(db.pool, "fremd@example.org"), []);
  });

  it("Karte ändern nur für eigene Bestellungen; nennt die fehlgeschlagene Rate", async () => {
    const t = (await cardChangeTarget(db.pool, "erika@example.org", orderId, "2026-11-01"))!;
    assert.equal(t.stripeCustomerId, "cus_erika");
    assert.ok(t.failedInstallmentId);
    assert.equal(await cardChangeTarget(db.pool, "fremd@example.org", orderId, "2026-11-01"), null);
    assert.equal(await cardChangeTarget(db.pool, "erika@example.org", "kein-uuid", "2026-11-01"), null);
  });
});
