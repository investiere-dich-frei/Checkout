import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { centsToPaypalAmount, handlePaypalCapture, paypalAmountToCents, rememberPaypalOrder, type PaypalCaptureInput } from "../src/paypal.ts";
import { nextPaymentTarget } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("PayPal-Zahlungen verbuchen", () => {
  let db: TestDb;
  let order: PlaceOrderInput;
  let aboOrder: PlaceOrderInput;

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

  const FAR = "2099-12-31";
  let n = 0;
  const capture = (order: string, amount: number, extra: Partial<NonNullable<PaypalCaptureInput["capture"]>> = {}): PaypalCaptureInput => {
    const id = `CAP${++n}`;
    return {
      eventId: `capture:${id}`,
      type: "capture",
      paypalOrderId: order,
      // 2026-11-02 23:30 UTC ist in Berlin schon der 03.11.
      capture: { id, status: "COMPLETED", amountCents: amount, currency: "EUR", customId: null, createdAt: new Date(Date.UTC(2026, 10, 2, 23, 30)), ...extra },
      payload: { id },
    };
  };
  const prepare = async (input: PlaceOrderInput, paypalId: string) => {
    const placed = await tx(db.pool, (c) => placeOrder(c, input));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, FAR))!;
    await rememberPaypalOrder(db.pool, { id: paypalId, installmentId: t.installmentId, amountCents: t.grossCents, currency: t.currency });
    return { orderId: placed.orderId, target: t };
  };

  it("rechnet PayPal-Beträge genau in Cent um", () => {
    assert.equal(paypalAmountToCents("1665.67"), 166567);
    assert.equal(paypalAmountToCents("99.9"), 9990);
    assert.equal(paypalAmountToCents("37"), 3700);
    assert.throws(() => paypalAmountToCents("1.234"));
    assert.throws(() => paypalAmountToCents("-1.00"));
    assert.equal(centsToPaypalAmount(166567), "1665.67");
    assert.equal(centsToPaypalAmount(5), "0.05");
  });

  it("bucht eine abgeschlossene Zahlung genau einmal, auch wenn der Webhook sie noch einmal meldet", async () => {
    const { orderId, target } = await prepare(order, "PP-A");
    const direct = capture("PP-A", target.grossCents, { customId: target.installmentId });
    const r = await tx(db.pool, (c) => handlePaypalCapture(c, direct));
    assert.equal(r.outcome, "gebucht");
    const inv = (await db.pool.query(`select issue_date::text d from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0];
    assert.equal(inv.d, "2026-11-03");
    const pay = (await db.pool.query(`select provider, provider_ref from app.payments where order_id = $1`, [orderId])).rows;
    assert.deepEqual(pay, [{ provider: "paypal", provider_ref: direct.capture!.id }]);

    // Dieselbe Zahlung kommt per Webhook mit eigener Ereignis-ID.
    const hook = { ...direct, eventId: "WH-1", type: "PAYMENT.CAPTURE.COMPLETED" };
    const again = await tx(db.pool, (c) => handlePaypalCapture(c, hook));
    assert.equal(again.outcome, "schon_gebucht");
    assert.equal(again.invoiceNumber, r.invoiceNumber);
    const repeat = await tx(db.pool, (c) => handlePaypalCapture(c, hook));
    assert.equal(repeat.firstDelivery, false);
    assert.equal((await db.pool.query(`select count(*)::int n from app.invoices where order_id = $1`, [orderId])).rows[0].n, 1);
  });

  it("bucht ausstehende, falsche und fremde Zahlungen nicht", async () => {
    const { orderId, target } = await prepare(aboOrder, "PP-B");
    assert.equal((await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-B", target.grossCents, { status: "PENDING" })))).outcome, "ignoriert");
    const wrong = await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-B", target.grossCents + 1)));
    assert.equal(wrong.outcome, "pruefen");
    assert.match(wrong.note!, /erwartet/);
    const chf = await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-B", target.grossCents, { currency: "CHF" })));
    assert.equal(chf.outcome, "pruefen");
    const otherInst = await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-B", target.grossCents, { customId: "00000000-0000-0000-0000-000000000000" })));
    assert.equal(otherInst.outcome, "pruefen");
    assert.equal((await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-THRIVECART", 100)))).outcome, "ignoriert");
    assert.equal((await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-X", 100, { customId: target.installmentId })))).outcome, "pruefen");
    assert.equal(
      (await tx(db.pool, (c) => handlePaypalCapture(c, { eventId: "WH-2", type: "CHECKOUT.ORDER.APPROVED", paypalOrderId: "PP-B", capture: null, payload: {} }))).outcome,
      "ignoriert",
    );
    assert.equal((await db.pool.query(`select count(*)::int n from app.invoices where order_id = $1`, [orderId])).rows[0].n, 0);
    // Der Abschluss der ausstehenden Zahlung wird dann gebucht.
    assert.equal((await tx(db.pool, (c) => handlePaypalCapture(c, capture("PP-B", target.grossCents)))).outcome, "gebucht");
  });

  it("schützt die Ablage vor Änderungen", async () => {
    await assert.rejects(db.pool.query(`update app.paypal_events set outcome = 'gebucht'`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from app.paypal_orders`), /GoBD/);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
});
