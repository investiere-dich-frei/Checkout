import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { endSubscription } from "../src/billing.ts";
import { placeOrder } from "../src/orders.ts";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "../src/stripe.ts";
import { deliverWebhooks, sign } from "../src/webhooks.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkt und Kundin; der Empfänger ist nachgebaut.
describe("Ausgehende Webhooks", () => {
  let db: TestDb;
  let orderId: string;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [company]);
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by, thrivecart_product_id)
       values ($1, 'Coaching', 'standard', true, now(), $2, 42) returning id`,
      [company, admin],
    );
    const abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Monatlich', 'abo', 9900, 'brutto', 9900, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    const placed = await tx(db.pool, (c) =>
      placeOrder(c, {
        priceOptionId: abo,
        customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
        vatIdVerified: false,
        sellerUserId: null,
        agbVersionId: legal[0]!,
        privacyVersionId: legal[1]!,
        withdrawalVersionId: legal[2]!,
        withdrawalWaiver: true,
        purchaseDay: "2026-11-02",
      }),
    );
    orderId = placed.orderId;
  });
  after(() => db.drop());

  it("meldet Zahlung und Abo-Ende signiert an den Empfänger und wiederholt bei Fehlern", async () => {
    const t = (await nextPaymentTarget(db.pool, orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: "pi_w", installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    await tx(db.pool, (c) =>
      handleStripeEvent(c, { id: "evt_w", type: "payment_intent.succeeded", created: Date.UTC(2026, 10, 2) / 1000, payload: {}, paymentIntent: { id: "pi_w", status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {} } }),
    );
    await tx(db.pool, (c) => endSubscription(c, orderId, "2026-12-01", "admin:test"));

    const received: { headers: Headers; body: string }[] = [];
    let up = false;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      if (!up) return new Response("down", { status: 503 });
      received.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response("ok");
    }) as unknown as typeof fetch;

    assert.deepEqual(await deliverWebhooks(db.pool, { url: "https://n8n.example.org/hook", secret: "geheim" }, fakeFetch), { delivered: 0, failed: 2 });
    await db.pool.query(`update app.webhook_outbox set next_attempt_at = now()`);
    up = true;
    assert.deepEqual(await deliverWebhooks(db.pool, { url: "https://n8n.example.org/hook", secret: "geheim" }, fakeFetch), { delivered: 2, failed: 0 });

    const [paid, ended] = received;
    assert.equal(paid!.headers.get("x-idf-event"), "zahlung.eingegangen");
    const ts = Number(paid!.headers.get("x-idf-timestamp"));
    assert.equal(paid!.headers.get("x-idf-signature"), sign("geheim", ts, paid!.body));
    const body = JSON.parse(paid!.body);
    assert.equal(body.order.customer.email, "erika@example.org");
    assert.equal(body.order.product.thrivecart_product_id, 42);
    assert.deepEqual({ ...body.payment, invoice_number: undefined }, { provider: "stripe", seq: 1, first: true, gross_cents: 9900, invoice_number: undefined });
    assert.equal(JSON.parse(ended!.body).event, "abo.beendet");
    await assert.rejects(db.pool.query(`update app.webhook_outbox set payload = '{}'`), /GoBD/);
  });
});
