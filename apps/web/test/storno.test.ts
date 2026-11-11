import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "@idf/db/auth";
import { placeOrder, type PlaceOrderInput } from "@idf/db/orders";
import { RefundError } from "@idf/db/refunds";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "@idf/db/stripe";
import type Stripe from "stripe";
import { createTestDb, tx, type TestDb } from "../../../packages/db/test/helpers.ts";
import { performStorno } from "../lib/storno";

// Ausgedachte Gesellschaft und Kundinnen; Stripe ist nachgebaut.
describe("Storno aus der Verwaltung", () => {
  let db: TestDb;
  let base: PlaceOrderInput;
  let admin: SessionUser;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [company]);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by) values ($1, 'Coaching', 'standard', true, now(), $2) returning id`,
      [company, adminId],
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
      purchaseDay: "2026-11-01",
    };
  });
  after(() => db.drop());

  const paid = async (email: string) => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...base, customer: { ...base.customer, email } }));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: `pi_${email}`, installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    const r = await tx(db.pool, (c) =>
      handleStripeEvent(c, { id: `evt_${email}`, type: "payment_intent.succeeded", created: Date.UTC(2026, 10, 1) / 1000, payload: {}, paymentIntent: { id: `pi_${email}`, status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {} } }),
    );
    const invoiceId = (await db.pool.query(`select id from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0].id as string;
    return { orderId: placed.orderId, invoiceId };
  };

  const stripeStub = (fail: string | null = null) => {
    const calls: Record<string, unknown>[] = [];
    const s = {
      refunds: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (params.payment_intent === fail) throw Object.assign(new Error("x"), { code: "charge_disputed" });
          return { id: `re_${calls.length}`, status: "succeeded" };
        },
      },
    } as unknown as Stripe;
    return { s, calls };
  };

  it("mit Rückzahlung: beendet die Raten, erstattet die Rechnung und schreibt den Storno fest", async () => {
    const p = await paid("mit@example.org");
    const st = stripeStub();
    const r = await performStorno(db.pool, { stripe: st.s, paypal: null }, admin, {
      orderId: p.orderId,
      kind: "mit_rueckzahlung",
      reason: "Widerruf",
      today: "2026-11-11",
      invoiceIds: [p.invoiceId],
    });
    assert.equal(r.ok, true, r.lines.join(" "));
    assert.equal(st.calls.length, 1);
    assert.equal(st.calls[0]!.amount, 10000);
    const status = (await db.pool.query(`select status from app.orders where id = $1`, [p.orderId])).rows[0].status;
    assert.equal(status, "erstattet");
    const inst = (await db.pool.query(`select status from app.order_installments where order_id = $1 order by seq`, [p.orderId])).rows.map((x) => x.status);
    assert.deepEqual(inst, ["storniert", "storniert", "storniert"]);
    const kinds = (await db.pool.query(`select kind from app.order_cancellations where order_id = $1`, [p.orderId])).rows.map((x) => x.kind);
    assert.deepEqual(kinds, ["mit_rueckzahlung"]);
  });

  it("ohne Rückzahlung: kein Anbieteraufruf, Bezahltes bleibt", async () => {
    const p = await paid("ohne@example.org");
    const st = stripeStub();
    const r = await performStorno(db.pool, { stripe: st.s, paypal: null }, admin, { orderId: p.orderId, kind: "ohne_rueckzahlung", reason: "Kündigung", today: "2026-11-11" });
    assert.equal(r.ok, true);
    assert.equal(st.calls.length, 0);
    const inst = (await db.pool.query(`select status from app.order_installments where order_id = $1 order by seq`, [p.orderId])).rows.map((x) => x.status);
    assert.deepEqual(inst, ["bezahlt", "storniert", "storniert"]);
    await assert.rejects(
      performStorno(db.pool, { stripe: st.s, paypal: null }, admin, { orderId: p.orderId, kind: "ohne_rueckzahlung", reason: "x", today: "2026-11-11", invoiceIds: [p.invoiceId] }),
      RefundError,
    );
  });

  it("abgelehnte Erstattung: Bestellung bleibt beendet, Hinweis auf erneutes Erstatten", async () => {
    const p = await paid("abgelehnt@example.org");
    const st = stripeStub("pi_abgelehnt@example.org");
    const r = await performStorno(db.pool, { stripe: st.s, paypal: null }, admin, {
      orderId: p.orderId,
      kind: "mit_rueckzahlung",
      reason: "Kulanz",
      today: "2026-11-11",
      invoiceIds: [p.invoiceId],
    });
    assert.equal(r.ok, false);
    assert.match(r.lines.join(" "), /charge_disputed.*erneut erstatten/);
    const inst = (await db.pool.query(`select status from app.order_installments where order_id = $1 order by seq`, [p.orderId])).rows.map((x) => x.status);
    assert.deepEqual(inst, ["bezahlt", "storniert", "storniert"]);
  });

  it("lehnt fremde Rechnungen und leere Auswahl ab, bevor etwas passiert", async () => {
    const a = await paid("a1@example.org");
    const b = await paid("b1@example.org");
    const st = stripeStub();
    await assert.rejects(
      performStorno(db.pool, { stripe: st.s, paypal: null }, admin, { orderId: a.orderId, kind: "mit_rueckzahlung", reason: "x", today: "2026-11-11", invoiceIds: [b.invoiceId] }),
      /gehört nicht/,
    );
    await assert.rejects(
      performStorno(db.pool, { stripe: st.s, paypal: null }, admin, { orderId: a.orderId, kind: "mit_rueckzahlung", reason: "x", today: "2026-11-11", invoiceIds: [] }),
      /mindestens eine/,
    );
    const n = (await db.pool.query(`select count(*)::int n from app.order_cancellations where order_id = $1`, [a.orderId])).rows[0].n;
    assert.equal(n, 0);
  });
});
