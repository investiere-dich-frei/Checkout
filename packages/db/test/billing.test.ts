import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { orderDetail } from "../src/admin.ts";
import { dueCharges, endSubscription, extendSubscriptions, recordChargeAttempt } from "../src/billing.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { cardSetupTarget, handleStripeEvent, nextPaymentTarget, rememberCardSetup, rememberPaymentIntent } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Wiederkehrende Zahlungen", () => {
  let db: TestDb;
  let order: PlaceOrderInput;
  let aboOrder: PlaceOrderInput;
  let trialOrder: PlaceOrderInput;

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
    const trial = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months, trial_days)
       values ($1, '0 € heute, dann 2 Raten', 'raten', 0, 'netto', 249850, 2, 2, 3, 42) returning id`,
      [product],
    );
    trialOrder = {
      ...order,
      priceOptionId: trial,
      customer: { ...order.customer, email: "probe@example.org" },
      purchaseDay: "2026-11-01",
    };
  });
  after(() => db.drop());

  // Erste Zahlung über die Bestellseite, mit Freigabe für spätere Einzüge.
  const payFirst = async (orderId: string, pi: string, pm: string | null) => {
    const t = (await nextPaymentTarget(db.pool, orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: pi, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    return tx(db.pool, (c) =>
      handleStripeEvent(c, {
        id: `evt_${pi}`,
        type: "payment_intent.succeeded",
        created: Date.UTC(2026, 0, 31, 12) / 1000,
        payload: {},
        paymentIntent: { id: pi, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {}, savedPaymentMethod: pm, stripeCustomer: "cus_x" },
      }),
    );
  };
  const due = async (orderId: string) =>
    (await db.pool.query(`select seq, due_date::text d, status from app.order_installments where order_id = $1 order by seq`, [orderId])).rows;

  it("verlängert Abos zum festgeschriebenen Termin, auch über kurze Monate", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    // Bedingungen sind festgeschrieben.
    await assert.rejects(db.pool.query(`update app.subscription_terms set tax_rate_bp = 1900`), /GoBD/);
    assert.equal(await tx(db.pool, (c) => extendSubscriptions(c, "2026-01-31")), 0);
    assert.equal(await tx(db.pool, (c) => extendSubscriptions(c, "2026-04-30")), 3);
    assert.equal(await tx(db.pool, (c) => extendSubscriptions(c, "2026-04-30")), 0);
    assert.deepEqual((await due(placed.orderId)).map((r) => r.d), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    const amounts = (await db.pool.query(`select distinct gross_cents::int g from app.order_installments where order_id = $1`, [placed.orderId])).rows;
    assert.deepEqual(amounts, [{ g: 9900 }]);
  });

  it("zieht ab der zweiten Rate mit gespeicherter Zahlungsart ein und versucht Ablehnungen begrenzt erneut", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    assert.equal((await payFirst(placed.orderId, "pi_first", "pm_saved")).outcome, "gebucht");
    const method = (await db.pool.query(`select provider, ref, provider_customer from app.saved_payment_methods where customer_id = $1`, [placed.customerId])).rows;
    assert.deepEqual(method, [{ provider: "stripe", ref: "pm_saved", provider_customer: "cus_x" }]);

    const mine = async (day: string) => (await dueCharges(db.pool, day)).filter((d) => d.orderId === placed.orderId);
    assert.equal((await mine("2026-12-01")).length, 0);
    const [second] = await mine("2026-12-02");
    assert.equal(second!.seq, 2);
    assert.deepEqual(second!.method, { provider: "stripe", ref: "pm_saved", providerCustomer: "cus_x" });

    await recordChargeAttempt(db.pool, { installmentId: second!.installmentId, provider: "stripe", providerRef: "pi_2a", outcome: "abgelehnt", errorCode: "insufficient_funds" });
    assert.equal((await due(placed.orderId))[1].status, "fehlgeschlagen");
    // Versuchstage festlegen (Testdaten), um die Wartezeiten zu prüfen.
    const at = (day: string) =>
      db.pool.query(`insert into app.charge_attempts (installment_id, provider, outcome, attempted_at) values ($1, 'stripe', 'abgelehnt', $2)`, [
        second!.installmentId,
        `${day} 10:00+01`,
      ]);
    // Den ersten Versuch (heute) zählen wir mit; die folgenden liegen nach der Fälligkeit.
    await at("2026-12-02");
    assert.equal((await mine("2026-12-02")).length, 0);
    // Zwei Versuche: nächster frühestens 4 Tage nach dem letzten.
    assert.equal((await mine("2026-12-05")).length, 0);
    assert.equal((await mine("2026-12-06")).length, 1);
    await at("2026-12-06");
    // Nach drei Versuchen übernimmt das Mahnwesen.
    assert.equal((await mine("2099-01-01")).length, 0);
  });

  it("zieht nicht ein, solange ein Einzug unterwegs ist, und ohne Freigabe gibt es keine Zahlungsart", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...order, customer: { ...order.customer, email: "ohne@example.org" } }));
    await payFirst(placed.orderId, "pi_nofuture", null);
    const [d] = (await dueCharges(db.pool, "2026-12-02")).filter((x) => x.orderId === placed.orderId);
    assert.equal(d!.method, null);
    await recordChargeAttempt(db.pool, { installmentId: d!.installmentId, provider: "stripe", providerRef: "pi_x", outcome: "eingereicht" });
    assert.equal((await dueCharges(db.pool, "2026-12-02")).filter((x) => x.orderId === placed.orderId).length, 0);
  });

  it("beendet ein Abo nach Kündigung: keine Verlängerung danach, offene spätere Raten entfallen", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    await tx(db.pool, (c) => extendSubscriptions(c, "2026-03-31"));
    assert.equal(await endSubscription(db.pool, placed.orderId, "2026-02-27", "admin:test"), true);
    assert.equal(await endSubscription(db.pool, placed.orderId, "2026-05-01", "admin:test"), false);
    // Die Verwaltung zeigt das Enddatum als Text (YYYY-MM-DD), nicht als Datumsobjekt.
    const admin = { id: "00000000-0000-0000-0000-000000000000", email: "a@example.org", displayName: "Admin", role: "admin" as const, salesCode: null };
    assert.equal((await orderDetail(db.pool, admin, placed.orderId))!.head.ends_on, "2026-02-27");
    await tx(db.pool, (c) => extendSubscriptions(c, "2026-12-31"));
    assert.deepEqual(
      (await due(placed.orderId)).map((r) => `${r.d} ${r.status}`),
      ["2026-01-31 offen", "2026-02-28 storniert", "2026-03-31 storniert"],
    );
    await assert.rejects(db.pool.query(`update app.subscription_terms set ends_on = null where order_id = $1`, [placed.orderId]), /GoBD/);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
  it("lässt bei Probezeit ohne Anzahlung die Karte hinterlegen und zieht dann auch die erste Zahlung ein", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, trialOrder));
    assert.deepEqual((await due(placed.orderId)).map((r) => r.d), ["2026-12-13", "2027-03-13"]);
    // Heute ist nichts fällig, also auch keine Zahlung auf der Bestellseite.
    assert.equal(await nextPaymentTarget(db.pool, placed.orderId, "2026-11-01"), null);
    const setup = (await cardSetupTarget(db.pool, placed.orderId))!;
    assert.deepEqual([setup.firstDueDate, setup.firstGrossCents], ["2026-12-13", 249850]);

    // Ohne hinterlegte Karte kann zum Fälligkeitstag nichts eingezogen werden.
    const mine = async (day: string) => (await dueCharges(db.pool, day)).filter((d) => d.orderId === placed.orderId);
    assert.equal((await mine("2026-12-13"))[0]!.method, null);

    // Eine Hinterlegung zu einer anderen Bestellung oder ohne Bestätigung zählt nicht.
    const base = { orderId: placed.orderId, status: "succeeded", paymentMethod: "pm_probe", stripeCustomerId: "cus_probe" };
    assert.equal(await rememberCardSetup(db.pool, { ...base, setupOrderId: order.priceOptionId }), false);
    assert.equal(await rememberCardSetup(db.pool, { ...base, setupOrderId: placed.orderId, status: "requires_payment_method" }), false);
    assert.equal(await rememberCardSetup(db.pool, { ...base, setupOrderId: placed.orderId }), true);
    assert.equal(await cardSetupTarget(db.pool, placed.orderId), null);

    assert.deepEqual(await mine("2026-12-12"), []);
    const charge = (await mine("2026-12-13"))[0]!;
    assert.deepEqual([charge.seq, charge.grossCents, charge.method?.ref], [1, 249850, "pm_probe"]);
  });
});
