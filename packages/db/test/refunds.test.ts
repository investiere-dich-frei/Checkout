import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { extendSubscriptions } from "../src/billing.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { cancelOrder, completeRefund, failRefund, RefundError, requestRefund } from "../src/refunds.ts";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Erstattung und Storno", () => {
  let db: TestDb;
  let order: PlaceOrderInput;
  let aboOrder: PlaceOrderInput;
  let admin: SessionUser;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
       values ($1, 'Coaching', 'steuerfrei_4_21', true, now(), $2) returning id`,
      [companyId, admin],
    );
    const raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '2 Raten', 'raten', 50000, 'netto', 50000, 1, 2, 1) returning id`,
      [product],
    );
    const abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Monatlich', 'abo', 9900, 'netto', 9900, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(
        await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]),
      );
    }
    order = {
      priceOptionId: raten,
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-11-02",
    };
    aboOrder = { ...order, priceOptionId: abo, purchaseDay: "2026-01-31" };
  });
  after(() => db.drop());

  const ready = async () => {
    if (!admin) {
      const id = (await db.pool.query(`select id from app.users where role = 'admin'`)).rows[0].id;
      admin = { id, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    }
  };
  let n = 0;
  const paidOrder = async (input: PlaceOrderInput) => {
    const placed = await tx(db.pool, (c) => placeOrder(c, input));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    const pi = `pi_r${++n}`;
    await rememberPaymentIntent(db.pool, { id: pi, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    const r = await tx(db.pool, (c) =>
      handleStripeEvent(c, { id: `evt_r${n}`, type: "payment_intent.succeeded", created: Date.UTC(2026, 10, 2) / 1000, payload: {}, paymentIntent: { id: pi, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {} } }),
    );
    const invoiceId = (await db.pool.query(`select id from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0].id as string;
    return { orderId: placed.orderId, invoiceId, pi, gross: t.grossCents };
  };

  it("storniert nach bestätigter Erstattung mit voller Stornorechnung, PDF und E-Mail", async () => {
    await ready();
    const p = await paidOrder(aboOrder);
    const req = await tx(db.pool, (c) => requestRefund(c, admin, p.invoiceId, "Widerruf vom 03.11."));
    assert.deepEqual({ ...req, refundId: undefined }, { refundId: undefined, provider: "stripe", paymentRef: p.pi, amountCents: p.gross, currency: "EUR" });
    // Eine zweite Anforderung für dieselbe Rechnung geht nicht.
    await assert.rejects(tx(db.pool, (c) => requestRefund(c, admin, p.invoiceId, "doppelt")));

    const s = await tx(db.pool, (c) => completeRefund(c, req.refundId, "re_1"));
    const again = await tx(db.pool, (c) => completeRefund(c, req.refundId, "re_1"));
    assert.equal(again.stornoInvoiceId, s.stornoInvoiceId);

    const inv = (await db.pool.query(`select kind, gross_cents::int g, pdf_sha256 is not null pdf, note from app.invoices where id = $1`, [s.stornoInvoiceId])).rows[0];
    assert.equal(inv.kind, "storno");
    assert.equal(inv.g, -p.gross);
    assert.equal(inv.pdf, true);
    assert.match(inv.note, /Storno zu Rechnung T-/);
    const pay = (await db.pool.query(`select status, amount_cents::int a from app.payments where provider_ref = 're_1'`)).rows[0];
    assert.deepEqual(pay, { status: "erstattet", a: -p.gross });
    const order = (await db.pool.query(`select status from app.orders where id = $1`, [p.orderId])).rows[0].status;
    assert.equal(order, "erstattet");
    const mail = (await db.pool.query(`select subject, body_text from app.mail_outbox where related_id = $1`, [s.stornoInvoiceId])).rows[0];
    assert.match(mail.subject, /^Deine Stornorechnung T-/);
    assert.match(mail.body_text, /erstattet/);
    await assert.rejects(tx(db.pool, (c) => requestRefund(c, admin, p.invoiceId, "nochmal")), RefundError);
    await assert.rejects(db.pool.query(`update app.refunds set reason = 'anders'`), /GoBD/);
  });

  it("lässt die Rechnung unverändert, wenn der Anbieter die Erstattung ablehnt", async () => {
    await ready();
    const p = await paidOrder(order);
    const req = await tx(db.pool, (c) => requestRefund(c, admin, p.invoiceId, "Kulanz"));
    await tx(db.pool, (c) => failRefund(c, req.refundId, "charge_already_refunded"));
    assert.equal((await db.pool.query(`select count(*)::int n from app.invoices where corrects_invoice_id = $1`, [p.invoiceId])).rows[0].n, 0);
    // Danach ist ein neuer Versuch möglich.
    const retry = await tx(db.pool, (c) => requestRefund(c, admin, p.invoiceId, "Kulanz, zweiter Versuch"));
    assert.notEqual(retry.refundId, req.refundId);
    const vera: SessionUser = { ...admin, role: "vertrieb" };
    await assert.rejects(tx(db.pool, (c) => requestRefund(c, vera, p.invoiceId, "x")), /Berechtigung/);
  });

  it("beendet eine Bestellung: offene Raten entfallen, das Abo verlängert sich nicht mehr", async () => {
    await ready();
    const p = await paidOrder(order);
    await tx(db.pool, (c) => cancelOrder(c, admin, p.orderId));
    const st = (await db.pool.query(`select status from app.order_installments where order_id = $1 order by seq`, [p.orderId])).rows.map((r) => r.status);
    assert.deepEqual(st, ["bezahlt", "storniert"]);
    const abo = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    await tx(db.pool, (c) => cancelOrder(c, admin, abo.orderId));
    await tx(db.pool, (c) => extendSubscriptions(c, "2099-12-31"));
    const rows = (await db.pool.query(`select status from app.order_installments where order_id = $1`, [abo.orderId])).rows;
    assert.deepEqual(rows.map((r) => r.status), ["storniert"]);
    assert.equal((await db.pool.query(`select status from app.orders where id = $1`, [abo.orderId])).rows[0].status, "storniert");
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
});
