import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { dueCharges, extendSubscriptions, manualChargeTarget } from "../src/billing.ts";
import {
  createTakeover,
  intervalMonths,
  markThrivecartStopped,
  takeoverOfOrder,
  takeoverOverview,
  takeoverRoute,
  type TakeoverInput,
} from "../src/takeover.ts";
import { enqueueWebhook } from "../src/webhooks.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Abos, keine echten Daten.
describe("Abo-Umzug: Übersicht", () => {
  let db: TestDb;
  const admin: SessionUser = { id: "00000000-0000-0000-0000-000000000001", email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };

  before(async () => {
    db = await createTestDb();
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind)
       select n, 'Test GmbH', '2025-01-01', 'EUR', 'abo' from generate_series(1, 5) n`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, email, status, processor, remote_subscription_id, amount_cents, payments_remaining, next_payment_at, source_row)
       values (1, 1, 'a@example.org', 'active', 'paypal_v2', 'I-TEST1', 9900, null, '2026-12-01', '{"item_name": "Club"}'),
              (2, 2, 'b@example.org', 'paused', 'paypal_v2', 'I-TEST2', 9900, null, null, '{}'),
              (3, 3, 'c@example.org', 'active', 'thrivepay', null, 25000, 2, '2026-11-15', '{}'),
              (4, 4, 'd@example.org', 'Active', 'stripe_v2', 'sub_test', 4900, null, '2026-11-20', '{}'),
              (5, 5, 'e@example.org', 'cancelled', 'stripe_v2', 'sub_alt', 4900, null, null, '{}')`,
    );
  });
  after(() => db.drop());

  it("ordnet Zahlungswege zu", () => {
    assert.equal(takeoverRoute("paypal_v2"), "paypal");
    assert.equal(takeoverRoute("thrivepay"), "thrivepay");
    assert.equal(takeoverRoute("stripe_v2"), "stripe");
    assert.equal(takeoverRoute(null), "unbekannt");
  });

  it("zählt nur laufende Abos, je Weg", async () => {
    const d = (await takeoverOverview(db.pool, admin))!;
    const by = Object.fromEntries(d.summary.map((s) => [s.route, s]));
    assert.equal(d.rows.length, 4);
    assert.deepEqual([by.paypal!.count, by.paypal!.paused], [2, 1]);
    assert.deepEqual([by.thrivepay!.count, by.thrivepay!.withoutRef, by.thrivepay!.endingSoon], [1, 1, 1]);
    assert.equal(by.stripe!.count, 1);
    assert.equal(d.rows[0]!.subscriptionId, "3");
    assert.equal((await takeoverOverview(db.pool, admin, { route: "paypal" }))!.rows.length, 2);
    assert.equal(await takeoverOverview(db.pool, { ...admin, role: "vertrieb" }), null);
  });
});

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Abo-Umzug: Übernahme einzelner Abos", () => {
  let db: TestDb;
  let admin: SessionUser;
  const today = "2026-11-01";
  const stripeCard = { customer: "cus_test", paymentMethod: "pm_test" };

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by) values ($1, 'Club', 'standard', true, now(), $2) returning id`,
      [company, adminId],
    );
    const unconfirmed = await q(`insert into app.products (company_id, name, tax_category, active) values ($1, 'Neu', 'standard', false) returning id`, [company]);
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      await db.pool.query(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now())`, [kind]);
    }
    const cust = async (email: string, kind = "privat", country = "DE", vat: string | null = null) =>
      q(`insert into app.customers (kind, last_name, company_name, email, country, vat_id) values ($1, 'Muster', $2, $3, $4, $5) returning id`, [
        kind,
        kind === "unternehmen" ? "Muster AG" : null,
        email,
        country,
        vat,
      ]);
    const c1 = await cust("raten@example.org");
    const c2 = await cust("abo@example.org", "privat", "AT");
    await cust("firma@example.org", "unternehmen", "AT", "ATU12345678");
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind)
       select n, 'Test GmbH', '2025-01-01', 'EUR', 'abo' from generate_series(11, 19) n`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, customer_id, email, status, processor, remote_subscription_id,
         frequency, currency, amount_cents, payments_remaining, next_payment_at, product_id, source_row)
       values (11, 11, $1, 'raten@example.org', 'active', 'thrivepay', 'sub_raten', 'month', 'EUR', 25000, 2, '2026-11-15 09:00+01', $3, '{}'),
              (12, 12, $2, 'abo@example.org', 'Active', 'stripe_v2', 'sub_abo', 'month', 'EUR', 4900, null, '2026-11-20 09:00+01', $3, '{}'),
              (13, 13, null, 'abo@example.org', 'active', 'paypal_v2', 'I-PAYPAL', '3month', 'EUR', 9900, 0, '2026-12-01 09:00+01', $3, '{}'),
              (14, 14, null, 'firma@example.org', 'active', 'stripe_v2', 'sub_firma', 'month', 'EUR', 10000, null, '2026-11-25 09:00+01', $3, '{}'),
              (15, 15, $1, 'raten@example.org', 'paused', 'stripe_v2', 'sub_pause', 'month', 'EUR', 10000, null, '2026-11-25 09:00+01', $3, '{}'),
              (16, 16, $1, 'raten@example.org', 'active', 'stripe_v2', 'sub_vorbei', 'month', 'EUR', 10000, null, '2026-11-01 09:00+01', $3, '{}'),
              (17, 17, $1, 'raten@example.org', 'active', 'stripe_v2', 'sub_woche', 'week', 'EUR', 10000, null, '2026-11-25 09:00+01', $3, '{}'),
              (18, 18, $1, 'raten@example.org', 'active', 'stripe_v2', 'sub_neu', 'month', 'EUR', 10000, null, '2026-11-25 09:00+01', $4, '{}')`,
      [c1, c2, product, unconfirmed],
    );
  });
  after(() => db.drop());

  const take = (input: Partial<TakeoverInput> & { subscriptionId: string }) =>
    tx(db.pool, (c) => createTakeover(c, admin, { today, stripe: stripeCard, ...input }));

  it("liest den Rhythmus", () => {
    assert.equal(intervalMonths("month"), 1);
    assert.equal(intervalMonths("3month"), 3);
    assert.equal(intervalMonths("year"), 12);
    assert.equal(intervalMonths("week"), null);
    assert.equal(intervalMonths(""), null);
  });

  it("übernimmt einen Ratenplan mit den offenen Raten und merkt die Karte", async () => {
    const r = await take({ subscriptionId: "11" });
    assert.deepEqual([r.firstDueOn, r.installments], ["2026-11-15", 2]);
    const inst = await db.pool.query(`select seq, due_date::text, gross_cents::int, tax_cents::int, status from app.order_installments where order_id = $1 order by seq`, [r.orderId]);
    assert.deepEqual(
      inst.rows.map((x) => [x.seq, x.due_date, x.gross_cents, x.status]),
      [
        [1, "2026-11-15", 25000, "offen"],
        [2, "2026-12-15", 25000, "offen"],
      ],
    );
    assert.equal(inst.rows[0].tax_cents, 3992); // 19 % aus 250,00 € brutto
    const terms = await db.pool.query(`select 1 from app.subscription_terms where order_id = $1`, [r.orderId]);
    assert.equal(terms.rowCount, 0);
    const invoices = await db.pool.query(`select 1 from app.invoices where order_id = $1`, [r.orderId]);
    assert.equal(invoices.rowCount, 0, "keine Rechnung beim Umzug");
    // Am Fälligkeitstag wird schon die erste Rate eingezogen, mit der gemerkten Karte.
    const due = (await dueCharges(db.pool, "2026-11-15")).filter((d) => d.orderId === r.orderId);
    assert.equal(due.length, 1);
    assert.deepEqual(due[0]!.method, { provider: "stripe", ref: "pm_test", providerCustomer: "cus_test" });
  });

  it("übernimmt ein Abo ohne Ende; weitere Fälligkeiten legt der tägliche Lauf an", async () => {
    const r = await take({ subscriptionId: "12", stripe: { customer: "cus_abo", paymentMethod: "pm_abo" }, firstDueOn: "2026-11-21" });
    assert.deepEqual([r.firstDueOn, r.installments], ["2026-11-21", 1]);
    await tx(db.pool, (c) => extendSubscriptions(c, "2027-01-31"));
    const inst = await db.pool.query(`select seq, due_date::text, tax_cents::int from app.order_installments where order_id = $1 order by seq`, [r.orderId]);
    assert.deepEqual(
      inst.rows.map((x) => x.due_date),
      ["2026-11-21", "2026-12-21", "2027-01-21"],
    );
    assert.equal(inst.rows[0].tax_cents, 817); // AT 20 % aus 49,00 €
    const t = (await takeoverOfOrder(db.pool, r.orderId))!;
    assert.deepEqual([t.route, t.remote_subscription_id, t.remaining_payments], ["stripe", "sub_abo", null]);
  });

  it("übernimmt dasselbe Abo kein zweites Mal", async () => {
    await assert.rejects(take({ subscriptionId: "11" }), /schon übernommen/);
  });

  it("lehnt ab, was nicht passt", async () => {
    await assert.rejects(take({ subscriptionId: "15" }), /Nur laufende Abos/);
    await assert.rejects(take({ subscriptionId: "16" }), /heute oder schon vorbei/);
    await assert.rejects(take({ subscriptionId: "17" }), /Rhythmus „week“/);
    await assert.rejects(take({ subscriptionId: "18" }), /Steuer noch nicht bestätigt/);
    await assert.rejects(take({ subscriptionId: "11x" }), /gibt es nicht/);
    await assert.rejects(take({ subscriptionId: "14", stripe: undefined }), /Karte bei Stripe fehlt/);
    await assert.rejects(tx(db.pool, (c) => createTakeover(c, { ...admin, role: "pruefer" }, { today, subscriptionId: "14", stripe: stripeCard })), /Keine Berechtigung/);
  });

  it("verlangt bei USt-IdNr. eine Prüfung, dann Reverse Charge", async () => {
    await assert.rejects(take({ subscriptionId: "14" }), /USt-IdNr/);
    const r = await take({ subscriptionId: "14", vatIdVerified: true });
    const i = await db.pool.query(`select tax_rate_bp from app.order_items where order_id = $1`, [r.orderId]);
    assert.equal(i.rows[0].tax_rate_bp, 0);
  });

  it("PayPal-Abo: kein Einzug durch uns, Meldung trägt die Übernahme", async () => {
    const r = await take({ subscriptionId: "13", stripe: undefined });
    assert.equal(r.firstDueOn, "2026-12-01");
    const due = (await dueCharges(db.pool, "2027-12-31")).filter((d) => d.orderId === r.orderId);
    assert.equal(due.length, 0);
    const inst = await db.pool.query(`select id from app.order_installments where order_id = $1 and seq = 1`, [r.orderId]);
    const target = await manualChargeTarget(db.pool, inst.rows[0].id, "2027-12-31");
    assert.deepEqual(target, { ok: false, reason: "paypal_abo" });
    await tx(db.pool, (c) => enqueueWebhook(c, "zahlung.eingegangen", r.orderId));
    const w = await db.pool.query(`select payload from app.webhook_outbox order by created_at desc limit 1`);
    assert.deepEqual(w.rows[0].payload.order.thrivecart_takeover, {
      subscription_id: 13,
      route: "paypal",
      remote_subscription_id: "I-PAYPAL",
      first_due_on: "2026-12-01",
    });
  });

  it("hält das Ende in Thrivecart einmal fest; sonst ist die Übernahme festgeschrieben", async () => {
    const t = await db.pool.query(`select order_id from app.thrivecart_takeovers where subscription_id = 11`);
    const orderId = t.rows[0].order_id;
    assert.equal(await tx(db.pool, (c) => markThrivecartStopped(c, admin, orderId)), true);
    assert.equal(await tx(db.pool, (c) => markThrivecartStopped(c, admin, orderId)), false);
    await assert.rejects(db.pool.query(`update app.thrivecart_takeovers set route = 'paypal' where order_id = $1`, [orderId]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`delete from app.thrivecart_takeovers where order_id = $1`, [orderId]));
    const o = (await takeoverOverview(db.pool, admin))!;
    const row = o.rows.find((x) => x.subscriptionId === "11")!;
    assert.deepEqual([row.takenOverOrderId, row.thrivecartStopped], [orderId, true]);
  });
});
