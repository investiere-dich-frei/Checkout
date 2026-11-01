import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "@idf/db/auth";
import type Stripe from "stripe";
import { createTestDb, type TestDb } from "../../../packages/db/test/helpers.ts";
import type { PaypalApi } from "../lib/paypal";
import { aboPaymentFromSale, stripeSource, syncPaypalAbos, takeOverPaypalSubscription, takeOverStripeSubscription } from "../lib/takeover";

// Ausgedachte Gesellschaft, Produkt und Kundin; Stripe ist nachgebaut.
describe("Abo-Umzug über Stripe", () => {
  let db: TestDb;
  let admin: SessionUser;
  const today = "2026-11-01";
  // 21.11.2026 00:30 in Berlin = 20.11. 23:30 UTC: gezählt wird der Berliner Tag.
  const periodEnd = Date.UTC(2026, 10, 20, 23, 30) / 1000;

  const sub = (over: Partial<Stripe.Subscription> = {}) =>
    ({
      id: "sub_abo",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: {},
      default_payment_method: null,
      customer: { id: "cus_1", deleted: undefined, invoice_settings: { default_payment_method: "pm_1" } },
      items: { data: [{ current_period_end: periodEnd }] },
      ...over,
    }) as unknown as Stripe.Subscription;

  const fakeStripe = (s: Stripe.Subscription | Error, updateFails = false) => {
    const updates: unknown[] = [];
    const api = {
      subscriptions: {
        retrieve: async () => {
          if (s instanceof Error) throw s;
          return s;
        },
        update: async (id: string, params: unknown) => {
          if (updateFails) throw new Error("Stripe nicht erreichbar");
          updates.push({ id, params });
          return s;
        },
      },
    } as unknown as Stripe;
    return { api, updates };
  };

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [company]);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by) values ($1, 'Club', 'standard', true, now(), $2) returning id`,
      [company, adminId],
    );
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      await db.pool.query(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now())`, [kind]);
    }
    const customer = await q(`insert into app.customers (kind, last_name, email, country) values ('privat', 'Muster', 'abo@example.org', 'DE') returning id`);
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind) values (1, 'Test GmbH', '2025-01-01', 'EUR', 'abo'), (2, 'Test GmbH', '2025-01-01', 'EUR', 'abo')`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, customer_id, email, status, processor, remote_subscription_id,
         frequency, currency, amount_cents, next_payment_at, product_id, source_row)
       values (1, 1, $1, 'abo@example.org', 'active', 'thrivepay', 'sub_abo', 'month', 'EUR', 4900, '2026-11-20 09:00+01', $2, '{}'),
              (2, 2, $1, 'abo@example.org', 'active', 'paypal_v2', 'I-ABC', 'month', 'EUR', 4900, '2026-11-20 09:00+01', $2, '{}')`,
      [customer, product],
    );
  });
  after(() => db.drop());

  it("liest Kunde, Karte und Periodenende (Berliner Tag)", async () => {
    assert.deepEqual(await stripeSource(fakeStripe(sub()).api, "sub_abo"), { customer: "cus_1", paymentMethod: "pm_1", periodEnd: "2026-11-21" });
    await assert.rejects(stripeSource(fakeStripe(sub({ cancel_at_period_end: true })).api, "sub_abo"), /schon gekündigt/);
    await assert.rejects(stripeSource(fakeStripe(sub({ status: "past_due" })).api, "sub_abo"), /nicht aktiv/);
    const missing = Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    await assert.rejects(stripeSource(fakeStripe(missing).api, "sub_abo"), /nicht zu finden/);
  });

  it("rollt zurück, wenn Stripe das Abo nicht kündigen kann", async () => {
    await assert.rejects(takeOverStripeSubscription(db.pool, fakeStripe(sub(), true).api, admin, { subscriptionId: "1", today }), /nicht erreichbar/);
    const n = await db.pool.query(`select count(*)::int n from app.thrivecart_takeovers`);
    assert.equal(n.rows[0].n, 0);
  });

  it("legt die Bestellung an und kündigt das Stripe-Abo zum Periodenende", async () => {
    const f = fakeStripe(sub());
    const r = await takeOverStripeSubscription(db.pool, f.api, admin, { subscriptionId: "1", today });
    assert.equal(r.firstDueOn, "2026-11-21");
    assert.deepEqual(f.updates, [{ id: "sub_abo", params: { cancel_at_period_end: true, metadata: { idf_takeover_order_id: r.orderId } } }]);
    const m = await db.pool.query(`select provider, ref, provider_customer from app.saved_payment_methods`);
    assert.deepEqual(m.rows, [{ provider: "stripe", ref: "pm_1", provider_customer: "cus_1" }]);
    const a = await db.pool.query(`select actor from app.audit_log where table_name = 'thrivecart_takeovers'`);
    assert.equal(a.rows[0].actor, `user:${admin.id}`);
  });

  it("nimmt PayPal-Abos nicht über den Stripe-Weg", async () => {
    await assert.rejects(takeOverStripeSubscription(db.pool, fakeStripe(sub()).api, admin, { subscriptionId: "2", today }), /PayPal-Abo/);
  });

  it("PayPal-Abo: übernimmt ab der nächsten Abbuchung und verbucht die Zahlung aus der Abfrage", async () => {
    const calls: string[] = [];
    const api = {
      getSubscription: async () => ({ id: "I-ABC", status: "ACTIVE", billing_info: { next_billing_time: "2026-11-20T10:00:00Z" } }),
      subscriptionTransactions: async (id: string) => {
        calls.push(id);
        return [
          { id: "SALE-ALT", status: "COMPLETED", amount_with_breakdown: { gross_amount: { currency_code: "EUR", value: "49.00" } }, time: "2026-10-20T10:00:00Z" },
          { id: "SALE-1", status: "COMPLETED", amount_with_breakdown: { gross_amount: { currency_code: "EUR", value: "49.00" } }, time: "2026-11-20T10:05:00Z" },
        ];
      },
    } as unknown as PaypalApi;
    const r = await takeOverPaypalSubscription(db.pool, api, admin, { subscriptionId: "2", today });
    assert.equal(r.firstDueOn, "2026-11-20");
    assert.deepEqual(await syncPaypalAbos(db.pool, api, "2026-11-19", true), { abos: 0, booked: 0, review: 0, errors: 0 });
    assert.deepEqual(await syncPaypalAbos(db.pool, api, "2026-11-20", true), { abos: 1, booked: 1, review: 0, errors: 0 });
    assert.deepEqual(calls, ["I-ABC"]);
    const inst = await db.pool.query(`select status from app.order_installments where order_id = $1`, [r.orderId]);
    assert.deepEqual(inst.rows, [{ status: "bezahlt" }]);
  });

  it("liest Abo-Zahlungen aus der PayPal-Meldung", () => {
    const sale = { id: "S1", state: "completed", amount: { total: "49.00", currency: "EUR" }, billing_agreement_id: "I-ABC", create_time: "2026-11-20T10:05:00Z" };
    assert.deepEqual(aboPaymentFromSale("PAYMENT.SALE.COMPLETED", sale, true), {
      subscriptionId: "I-ABC",
      transactionId: "S1",
      status: "COMPLETED",
      amountCents: 4900,
      currency: "EUR",
      paidAt: new Date("2026-11-20T10:05:00Z"),
      live: true,
      source: "webhook",
    });
    assert.equal(aboPaymentFromSale("PAYMENT.CAPTURE.COMPLETED", sale, true), null);
    assert.equal(aboPaymentFromSale("PAYMENT.SALE.COMPLETED", { ...sale, billing_agreement_id: undefined }, true), null);
  });
});
