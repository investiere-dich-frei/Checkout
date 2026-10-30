import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent, rememberStripeCustomer, type StripeEventInput } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Stripe-Zahlungen verbuchen", () => {
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
  const succeeded = (pi: string, amount: number, extra: Partial<NonNullable<StripeEventInput["paymentIntent"]>> = {}): StripeEventInput => ({
    id: `evt_${++n}`,
    type: "payment_intent.succeeded",
    // 2026-11-02 23:30 UTC ist in Berlin schon der 03.11.
    created: Date.UTC(2026, 10, 2, 23, 30) / 1000,
    payload: { id: `evt_${n}`, object: "event" },
    paymentIntent: { id: pi, status: "succeeded", amountReceived: amount, currency: "eur", metadata: {}, ...extra },
  });

  it("findet die erste offene Fälligkeit und merkt sich Kunde und Zahlungsabsicht", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const t = await nextPaymentTarget(db.pool, placed.orderId, FAR);
    assert.ok(t);
    assert.deepEqual(
      { seq: t.seq, gross: t.grossCents, currency: t.currency, name: t.name, recurring: t.recurring, pi: t.paymentIntentId, cus: t.stripeCustomerId },
      { seq: 1, gross: 50000, currency: "EUR", name: "Erika Muster", recurring: true, pi: null, cus: null },
    );
    await rememberStripeCustomer(db.pool, t.customerId, "cus_test1");
    await rememberStripeCustomer(db.pool, t.customerId, "cus_test2");
    await rememberPaymentIntent(db.pool, { id: "pi_a", installmentId: t.installmentId, amountCents: 50000, currency: "eur" });
    await rememberPaymentIntent(db.pool, { id: "pi_a", installmentId: t.installmentId, amountCents: 50000, currency: "eur" });
    const again = await nextPaymentTarget(db.pool, placed.orderId, FAR);
    assert.equal(again?.paymentIntentId, "pi_a");
    assert.equal(again?.stripeCustomerId, "cus_test1");
  });

  it("bucht eine passende Zahlung genau einmal und stellt die Rechnung mit Berliner Datum aus", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, FAR))!;
    await rememberPaymentIntent(db.pool, { id: "pi_b", installmentId: t.installmentId, amountCents: 50000, currency: "eur" });

    const ev = succeeded("pi_b", 50000, { metadata: { installment_id: t.installmentId } });
    const r = await tx(db.pool, (c) => handleStripeEvent(c, ev));
    assert.equal(r.outcome, "gebucht");
    assert.match(r.invoiceNumber!, /^T-\d+$/);
    const inv = (await db.pool.query(`select issue_date::text d from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0];
    assert.equal(inv.d, "2026-11-03");

    // Dasselbe Ereignis noch einmal: keine zweite Rechnung.
    const dup = await tx(db.pool, (c) => handleStripeEvent(c, ev));
    assert.deepEqual({ ...dup }, { outcome: "gebucht", note: null, invoiceNumber: r.invoiceNumber, firstDelivery: false });
    // Ein neues Ereignis zur selben Zahlung: erkannt, nicht neu gebucht.
    const second = await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_b", 50000)));
    assert.equal(second.outcome, "schon_gebucht");
    assert.equal(second.invoiceNumber, r.invoiceNumber);
    const count = (await db.pool.query(`select count(*)::int n from app.invoices where order_id = $1`, [placed.orderId])).rows[0].n;
    assert.equal(count, 1);
    // Die zweite Rate ist erst einen Monat später fällig.
    assert.equal(await nextPaymentTarget(db.pool, placed.orderId, "2026-11-02"), null);
    assert.equal((await nextPaymentTarget(db.pool, placed.orderId, "2026-12-02"))?.seq, 2);
  });

  it("bucht nichts bei falschem Betrag oder fremder Zahlung und legt das Ereignis zur Prüfung ab", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, FAR))!;
    assert.equal(t.recurring, true);
    await rememberPaymentIntent(db.pool, { id: "pi_c", installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });

    const wrong = await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_c", t.grossCents - 1)));
    assert.equal(wrong.outcome, "pruefen");
    assert.match(wrong.note!, /erwartet/);
    const foreign = await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_thrivecart", 100)));
    assert.equal(foreign.outcome, "ignoriert");
    const suspicious = await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_x", 100, { metadata: { installment_id: t.installmentId } })));
    assert.equal(suspicious.outcome, "pruefen");
    const other = await tx(db.pool, (c) => handleStripeEvent(c, { id: `evt_${++n}`, type: "charge.refunded", created: 0, payload: {} }));
    assert.equal(other.outcome, "ignoriert");

    assert.equal((await db.pool.query(`select count(*)::int n from app.invoices where order_id = $1`, [placed.orderId])).rows[0].n, 0);
    const review = (await db.pool.query(`select count(*)::int n from app.stripe_events where outcome = 'pruefen'`)).rows[0].n;
    assert.equal(review, 2);
  });

  it("legt eine Zahlung zur Prüfung ab, wenn die Fälligkeit schon anders beglichen ist", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, FAR))!;
    await rememberPaymentIntent(db.pool, { id: "pi_d1", installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    await rememberPaymentIntent(db.pool, { id: "pi_d2", installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    assert.equal((await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_d1", t.grossCents)))).outcome, "gebucht");
    const late = await tx(db.pool, (c) => handleStripeEvent(c, succeeded("pi_d2", t.grossCents)));
    assert.equal(late.outcome, "pruefen");
    assert.match(late.note!, /anderen Zahlung/);
  });

  it("schützt die Ablage vor Änderungen", async () => {
    await assert.rejects(db.pool.query(`update app.stripe_events set outcome = 'gebucht'`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from app.stripe_payment_intents`), /GoBD/);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
});
