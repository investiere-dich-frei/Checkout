import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "@idf/db/auth";
import { placeOrder, type PlaceOrderInput } from "@idf/db/orders";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "@idf/db/stripe";
import type Stripe from "stripe";
import { createTestDb, tx, type TestDb } from "../../../packages/db/test/helpers.ts";
import { refundInvoice } from "../lib/refund";

// Ausgedachte Gesellschaft und Kundinnen; Stripe ist nachgebaut.
describe("Erstattung über den Anbieter", () => {
  let db: TestDb;
  let base: PlaceOrderInput;

  before(async () => {
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
  after(() => db.drop());

  const paid = async (email: string) => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...base, customer: { ...base.customer, email } }));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: `pi_${email}`, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    const r = await tx(db.pool, (c) =>
      handleStripeEvent(c, { id: `evt_${email}`, type: "payment_intent.succeeded", created: Date.UTC(2026, 8, 1) / 1000, payload: {}, paymentIntent: { id: `pi_${email}`, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {} } }),
    );
    return (await db.pool.query(`select id from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0].id as string;
  };

  it("erstattet bei Stripe mit Idempotenzschlüssel und storniert erst danach", async () => {
    const adminId = (await db.pool.query(`select id from app.users where role = 'admin'`)).rows[0].id;
    const admin: SessionUser = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    const ok = await paid("ok@example.org");
    const declined = await paid("no@example.org");
    const calls: { params: Record<string, unknown>; key: string }[] = [];
    const fakeStripe = {
      refunds: {
        create: async (params: Record<string, unknown>, opts: { idempotencyKey: string }) => {
          calls.push({ params, key: opts.idempotencyKey });
          if (params.payment_intent === "pi_no@example.org") throw Object.assign(new Error("x"), { code: "charge_disputed" });
          return { id: `re_ok_${calls.length}`, status: "succeeded" };
        },
      },
    } as unknown as Stripe;

    const r = await refundInvoice(db.pool, { stripe: fakeStripe, paypal: null }, admin, ok, "Widerruf");
    assert.ok(r.ok);
    assert.match(calls[0]!.key, /^erstattung-/);
    assert.equal(calls[0]!.params.amount, 10000);

    const bad = await refundInvoice(db.pool, { stripe: fakeStripe, paypal: null }, admin, declined, "Kulanz");
    assert.deepEqual(bad, { ok: false, message: "Erstattung abgelehnt (charge_disputed). Die Rechnung bleibt unverändert." });
    const storno = (await db.pool.query(`select count(*)::int n from app.invoices where corrects_invoice_id = $1`, [declined])).rows[0].n;
    assert.equal(storno, 0);

    // Teilbetrag: Stripe bekommt genau diesen Betrag, es entsteht eine Rechnungskorrektur.
    const partial = await paid("teil@example.org");
    const t = await refundInvoice(db.pool, { stripe: fakeStripe, paypal: null }, admin, partial, "Kulanz", 2500);
    assert.ok(t.ok && t.scope === "teil" && t.amountCents === 2500);
    assert.equal(calls.at(-1)!.params.amount, 2500);
    const kind = (await db.pool.query(`select kind from app.invoices where corrects_invoice_id = $1`, [partial])).rows.map((r) => r.kind);
    assert.deepEqual(kind, ["korrektur"]);
  });
});
