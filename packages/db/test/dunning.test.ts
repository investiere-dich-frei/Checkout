import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { extendSubscriptions, recordChargeAttempt } from "../src/billing.ts";
import { portalEmail } from "../src/customer-portal.ts";
import {
  cardExpiresBefore,
  cardsToCheck,
  cardValidUntil,
  dunningCases,
  dunningNoticesOfOrder,
  rememberCard,
  sendDunningNotice,
  type DunningCase,
} from "../src/dunning.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Mahnwesen", () => {
  let db: TestDb;
  let raten: PlaceOrderInput;
  let quartal: PlaceOrderInput;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

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
    const ratenOption = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '2 Raten', 'raten', 50000, 'netto', 50000, 1, 2, 1) returning id`,
      [product],
    );
    const quartalOption = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Vierteljährlich', 'abo', 30000, 'netto', 30000, 3) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(
        await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]),
      );
    }
    raten = {
      priceOptionId: ratenOption,
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-11-02",
    };
    quartal = { ...raten, priceOptionId: quartalOption, customer: { ...raten.customer, email: "quartal@example.org" }, purchaseDay: "2026-11-01" };
  });
  after(() => db.drop());

  let n = 0;
  const payFirst = async (orderId: string, pm: string) => {
    const t = (await nextPaymentTarget(db.pool, orderId, "2099-12-31"))!;
    const pi = `pi_m${++n}`;
    await rememberPaymentIntent(db.pool, { id: pi, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    await tx(db.pool, (c) =>
      handleStripeEvent(c, {
        id: `evt_${pi}`,
        type: "payment_intent.succeeded",
        created: Date.UTC(2026, 10, 2, 12) / 1000,
        payload: {},
        paymentIntent: { id: pi, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {}, savedPaymentMethod: pm, stripeCustomer: "cus_m" },
      }),
    );
  };
  const seq2 = async (orderId: string) =>
    (await db.pool.query(`select id, due_date::text d from app.order_installments where order_id = $1 and seq = 2`, [orderId])).rows[0] as { id: string; d: string };
  const send = (c: DunningCase) => tx(db.pool, (client) => sendDunningNotice(client, c, "https://kasse.example.org/"));
  const mailOf = async (orderId: string) =>
    (await db.pool.query(`select subject, body_text from app.mail_outbox where purpose = 'mahnwesen' and related_id = $1 order by created_at desc limit 1`, [orderId])).rows[0];

  it("erinnert vor Abbuchungen mit langem Abstand, nicht bei monatlichen", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, raten));
    await payFirst(r.orderId, "pm_raten");
    const qo = await tx(db.pool, (c) => placeOrder(c, quartal));
    await payFirst(qo.orderId, "pm_quartal");
    await tx(db.pool, (c) => extendSubscriptions(c, "2027-02-01"));
    const next = await seq2(qo.orderId);
    assert.equal(next.d, "2027-02-01");
    const cases = await dunningCases(db.pool, "2027-01-26");
    const reminders = cases.filter((c) => c.kind === "erinnerung");
    assert.deepEqual(reminders.map((c) => c.orderId), [qo.orderId]);
    // Monatliche Raten: keine Erinnerung.
    assert.equal((await dunningCases(db.pool, "2026-11-27")).filter((c) => c.kind === "erinnerung").length, 0);
    assert.equal(await send(reminders[0]!), true);
    assert.equal(await send(reminders[0]!), false);
    const mail = await mailOf(qo.orderId);
    assert.match(mail.subject, /^Bald fällig: deine Zahlung für Coaching/);
    assert.match(mail.body_text, /am 01\.02\.2027 buchen wir 300,00\s€ für Coaching/);
    // Der Link führt in den Kundenbereich der Kundin.
    const token = /\/konto\/([A-Za-z0-9_-]{43})/.exec(mail.body_text)![1]!;
    assert.equal(await portalEmail(db.pool, token), "quartal@example.org");
  });

  it("mahnt nach jedem abgelehnten Versuch und zuletzt mit letzter Mahnung", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...raten, customer: { ...raten.customer, email: "fehl@example.org" } }));
    await payFirst(r.orderId, "pm_fehl");
    const inst = await seq2(r.orderId);
    await tx(db.pool, (c) => recordChargeAttempt(c, { installmentId: inst.id, provider: "stripe", providerRef: "pi_x1", outcome: "abgelehnt", errorCode: "card_declined" }));
    let mine = (await dunningCases(db.pool, today)).filter((c) => c.orderId === r.orderId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.kind, "fehlgeschlagen");
    assert.equal(mine[0]!.attempts, 1);
    assert.ok(mine[0]!.nextTry! > today);
    assert.equal(await send(mine[0]!), true);
    assert.equal(await send(mine[0]!), false);
    const mail = await mailOf(r.orderId);
    assert.match(mail.subject, /^Zahlung nicht geklappt/);
    assert.match(mail.body_text, /hat leider nicht geklappt/);
    const hook = (await db.pool.query(`select payload from app.webhook_outbox where event_type = 'zahlung.fehlgeschlagen' order by created_at desc limit 1`)).rows[0];
    assert.equal(hook.payload.final, false);
    assert.equal(hook.payload.order.order_id, r.orderId);
    // Nach drei Versuchen: letzte Mahnung, nur einmal.
    for (const ref of ["pi_x2", "pi_x3"]) {
      await tx(db.pool, (c) => recordChargeAttempt(c, { installmentId: inst.id, provider: "stripe", providerRef: ref, outcome: "abgelehnt", errorCode: "card_declined" }));
    }
    mine = (await dunningCases(db.pool, today)).filter((c) => c.orderId === r.orderId);
    assert.deepEqual(mine.map((c) => c.kind), ["letzte_mahnung"]);
    assert.equal(await send(mine[0]!), true);
    assert.match((await mailOf(r.orderId)).body_text, /nicht mehr automatisch/);
    // Alte Fehlversuche werden nicht nachträglich gemahnt.
    assert.equal((await dunningCases(db.pool, "2027-06-01")).filter((c) => c.orderId === r.orderId).length, 0);
    const list = await dunningNoticesOfOrder(db.pool, r.orderId);
    assert.deepEqual(list.map((x) => x.kind), ["fehlgeschlagen", "letzte_mahnung"]);
    await assert.rejects(db.pool.query(`delete from app.dunning_notices where order_id = $1`, [r.orderId]));
  });

  it("bittet um eine Zahlungsart, wenn keine hinterlegt ist", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...raten, customer: { ...raten.customer, email: "ohne@example.org" } }));
    const inst = await seq2(r.orderId);
    const mine = (await dunningCases(db.pool, "2026-12-03")).filter((c) => c.orderId === r.orderId);
    assert.deepEqual(mine.map((c) => [c.kind, c.installmentId]), [["ohne_zahlungsart", inst.id]]);
    assert.equal(await send(mine[0]!), true);
    assert.match((await mailOf(r.orderId)).subject, /^Bitte Zahlungsart hinterlegen/);
  });

  it("warnt, wenn die Karte vor der nächsten Abbuchung abläuft", async () => {
    assert.equal(cardValidUntil(2, 2028), "2028-02-29");
    assert.equal(cardExpiresBefore({ expMonth: 11, expYear: 2026 }, "2026-12-02"), true);
    assert.equal(cardExpiresBefore({ expMonth: 12, expYear: 2026 }, "2026-12-02"), false);
    const cards = await cardsToCheck(db.pool, "2026-11-25");
    const k = cards.find((c) => c.ref === "pm_raten")!;
    assert.equal(k.cached, null);
    assert.equal(k.dueDate, "2026-12-02");
    const card = { brand: "visa", last4: "4242", expMonth: 11, expYear: 2026 };
    await rememberCard(db.pool, k.ref, card);
    assert.deepEqual((await cardsToCheck(db.pool, "2026-11-25")).find((c) => c.ref === "pm_raten")!.cached, card);
    assert.equal(await send({ kind: "karte_ablauf", key: `karte_ablauf:${k.ref}`, orderId: k.orderId, installmentId: k.installmentId, card }), true);
    assert.match((await mailOf(k.orderId)).body_text, /VISA, endet auf 4242\) gilt nur bis 11\/2026/);
    assert.equal((await cardsToCheck(db.pool, "2026-11-25")).some((c) => c.ref === "pm_raten"), false);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
});
