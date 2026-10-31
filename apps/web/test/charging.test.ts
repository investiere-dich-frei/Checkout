import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { placeOrder, type PlaceOrderInput } from "@idf/db/orders";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "@idf/db/stripe";
import type Stripe from "stripe";
import { createTestDb, tx, type TestDb } from "../../../packages/db/test/helpers.ts";
import { runCharging } from "../lib/charging";
import type { PaypalApi } from "../lib/paypal";

// Ausgedachte Gesellschaft, Produkte und Kundinnen; Stripe und PayPal sind nachgebaut.
describe("Täglicher Einzug", () => {
  let db: TestDb;
  let base: PlaceOrderInput;

  const paypalEnv = process.env.PAYPAL_ENV;
  before(async () => {
    // Die nachgebaute PayPal-Antwort gilt als echte Zahlung, wie die Datenbank (live).
    process.env.PAYPAL_ENV = "live";
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [company]);
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by) values ($1, 'Coaching', 'standard', true, now(), $2) returning id`,
      [company, admin],
    );
    const raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 10000, 'brutto', 10000, 2, 3, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    base = {
      priceOptionId: raten,
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-09-01",
    };
  });
  after(async () => {
    if (paypalEnv === undefined) delete process.env.PAYPAL_ENV;
    else process.env.PAYPAL_ENV = paypalEnv;
    await db.drop();
  });

  const placeAndPayFirst = async (email: string, pm: string) => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...base, customer: { ...base.customer, email } }));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: `pi_${email}`, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    await tx(db.pool, (c) =>
      handleStripeEvent(c, {
        id: `evt_${email}`,
        type: "payment_intent.succeeded",
        created: Date.UTC(2026, 8, 1) / 1000,
        payload: {},
        paymentIntent: { id: `pi_${email}`, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {}, savedPaymentMethod: pm, stripeCustomer: "cus_t" },
      }),
    );
    return placed.orderId;
  };

  it("legt Zahlungen bei Stripe an, merkt sie vor der Bestätigung und hält Ablehnungen fest", async () => {
    const ok = await placeAndPayFirst("ok@example.org", "pm_ok");
    const bad = await placeAndPayFirst("bad@example.org", "pm_declined");
    let n = 0;
    const created: Record<string, unknown>[] = [];
    const confirmParams: Record<string, unknown>[] = [];
    const fakeStripe = {
      paymentIntents: {
        create: async (params: Record<string, unknown>) => {
          // Wie bei Stripe: off_session ist beim Anlegen nur zusammen mit confirm erlaubt.
          if (params.off_session !== undefined && params.confirm !== true) throw new Error("off_session ohne confirm");
          created.push(params);
          // Beim Bestätigen muss die Zahlungsabsicht schon gemerkt sein.
          return { id: `pi_einzug_${++n}`, amount: params.amount, currency: params.currency };
        },
        confirm: async (id: string, params: Record<string, unknown>) => {
          confirmParams.push(params);
          const known = (await db.pool.query(`select 1 from app.stripe_payment_intents where id = $1`, [id])).rowCount;
          assert.equal(known, 1);
          const p = created[Number(id.split("_").pop()) - 1]!;
          if (p.payment_method === "pm_declined") throw Object.assign(new Error("declined"), { type: "StripeCardError", decline_code: "insufficient_funds" });
          return { id, status: "succeeded" };
        },
      },
    } as unknown as Stripe;

    const run = await runCharging(db.pool, { stripe: fakeStripe, paypal: null }, "2026-10-01");
    assert.deepEqual(run, { extended: 0, due: 2, submitted: 1, booked: 0, declined: 1, withoutMethod: 0, errors: 0 });
    assert.ok(created.every((p) => p.off_session === undefined && (p.metadata as Record<string, string>).installment_id));
    assert.ok(confirmParams.length === 2 && confirmParams.every((p) => p.off_session === true));
    const statuses = async (o: string) => (await db.pool.query(`select status from app.order_installments where order_id = $1 order by seq`, [o])).rows.map((r) => r.status);
    assert.deepEqual(await statuses(bad), ["bezahlt", "fehlgeschlagen", "offen"]);
    assert.deepEqual(await statuses(ok), ["bezahlt", "offen", "offen"]);
    const codes = (await db.pool.query(`select distinct error_code from app.charge_attempts where outcome = 'abgelehnt'`)).rows;
    assert.deepEqual(codes, [{ error_code: "insufficient_funds" }]);
    // Eingereichte Einzüge werden nicht doppelt angestoßen.
    const again = await runCharging(db.pool, { stripe: fakeStripe, paypal: null }, "2026-10-01");
    assert.equal(again.submitted, 0);
  });

  it("hält ein gescheitertes Anlegen bei Stripe als Fehlversuch fest und nutzt danach einen neuen Schlüssel", async () => {
    const order = await placeAndPayFirst("create-fail@example.org", "pm_createfail");
    const keys: string[] = [];
    let fail = true;
    const fakeStripe = {
      paymentIntents: {
        create: async (params: Record<string, unknown>, opts: { idempotencyKey: string }) => {
          const seq = (params.metadata as Record<string, string>).seq;
          if (params.payment_method !== "pm_createfail" || seq !== "2") return { id: `pi_other_${opts.idempotencyKey}`, amount: params.amount, currency: params.currency };
          keys.push(opts.idempotencyKey);
          if (fail) throw Object.assign(new Error("idempotency"), { type: "StripeIdempotencyError" });
          return { id: "pi_createfail_ok", amount: params.amount, currency: params.currency };
        },
        confirm: async (id: string) => ({ id, status: "succeeded" }),
      },
    } as unknown as Stripe;

    await runCharging(db.pool, { stripe: fakeStripe, paypal: null }, "2026-10-01");
    const attempts = async () =>
      (await db.pool.query(
        `select a.outcome, a.error_code, a.provider_ref from app.charge_attempts a join app.order_installments i on i.id = a.installment_id where i.order_id = $1 order by a.attempted_at`,
        [order],
      )).rows;
    assert.deepEqual(await attempts(), [{ outcome: "fehler", error_code: "StripeIdempotencyError", provider_ref: null }]);

    // Nach der Wartezeit versucht der nächste Lauf es mit einem neuen Schlüssel.
    fail = false;
    await runCharging(db.pool, { stripe: fakeStripe, paypal: null }, "2026-12-31");
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
    assert.deepEqual((await attempts()).map((a) => a.outcome).slice(0, 2), ["fehler", "eingereicht"]);
  });

  it("zieht über ein gespeichertes PayPal-Konto ein und bucht sofort", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...base, customer: { ...base.customer, email: "pp@example.org" } }));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    // Erste Zahlung als bezahlt markieren (über PayPal-Weg) und Vault merken.
    await db.pool.query(`insert into app.saved_payment_methods (customer_id, provider, ref) values ($1, 'paypal', 'VAULT1')`, [placed.customerId]);
    await db.pool.query(`insert into app.paypal_orders (id, installment_id, amount_cents, currency) values ('PPFIRST', $1, $2, 'EUR')`, [t.installmentId, t.grossCents]);
    let calls = 0;
    const fakePaypal = {
      chargeVault: async (input: { installmentId: string; amountCents: number; vaultId: string }) => {
        calls++;
        assert.equal(input.vaultId, "VAULT1");
        return {
          id: `PPORDER${calls}`,
          status: "COMPLETED",
          purchase_units: [
            { payments: { captures: [{ id: `CAPV${calls}`, status: "COMPLETED", amount: { currency_code: "EUR", value: (input.amountCents / 100).toFixed(2) }, custom_id: input.installmentId, create_time: "2026-10-01T08:00:00Z" }] } },
          ],
        };
      },
    } as unknown as PaypalApi;
    const run = await runCharging(db.pool, { stripe: null, paypal: fakePaypal }, "2026-10-01");
    assert.equal(run.booked, 1);
    const paid = (await db.pool.query(`select seq, status from app.order_installments where order_id = $1 order by seq`, [placed.orderId])).rows;
    assert.deepEqual(paid.map((r) => r.status), ["offen", "bezahlt", "offen"]);
    const mail = (await db.pool.query(`select count(*)::int n from app.mail_outbox m join app.invoices i on i.id = m.related_id where i.order_id = $1`, [placed.orderId])).rows[0].n;
    assert.equal(mail, 1);
  });
});
