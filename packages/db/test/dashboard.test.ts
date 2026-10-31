import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { recordChargeAttempt } from "../src/billing.ts";
import { checkRange, dashboard, presetRange, previousRange } from "../src/dashboard.ts";
import { recordInstallmentPayment } from "../src/invoicing.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { completeRefund, requestRefund } from "../src/refunds.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

describe("Dashboard: Zeiträume", () => {
  it("rechnet Auswahl und Vergleichszeitraum", () => {
    assert.deepEqual(presetRange("7", "2026-10-31"), { from: "2026-10-25", to: "2026-10-31" });
    assert.deepEqual(presetRange("monat", "2026-10-31"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(presetRange("vormonat", "2026-03-15"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(presetRange("vormonat", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(presetRange("jahr", "2026-10-31"), { from: "2026-01-01", to: "2026-10-31" });
    assert.deepEqual(previousRange({ from: "2026-10-25", to: "2026-10-31" }), { from: "2026-10-18", to: "2026-10-24" });
    assert.equal(checkRange({ from: "2026-10-31", to: "2026-10-01" }), null);
    assert.equal(checkRange({ from: "2026-13-01", to: "2026-13-02" }), null);
  });
});

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Dashboard: Kennzahlen", () => {
  let db: TestDb;
  let admin: SessionUser;
  let vertrieb: SessionUser;
  let base: Omit<PlaceOrderInput, "priceOptionId" | "customer">;
  const opt: Record<string, string> = {};

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const vId = await q(`insert into app.users (email, display_name, role, sales_code) values ('v@example.org', 'Vera Vertrieb', 'vertrieb', 'vera') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    vertrieb = { id: vId, email: "v@example.org", displayName: "Vera Vertrieb", role: "vertrieb", salesCode: "vera" };
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
       values ($1, 'Kurs', 'standard', true, now(), $2) returning id`,
      [companyId, adminId],
    );
    opt.einmal = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Einmal', 'einmal', 11900, 'brutto') returning id`,
      [product],
    );
    opt.raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 5000, 'brutto', 5000, 2, 3, 1) returning id`,
      [product],
    );
    opt.abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Abo', 'abo', 6900, 'brutto', 6900, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    base = {
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: today,
    };

    const consumer = (country: string) => ({ kind: "privat" as const, first_name: "Erika", last_name: "Muster", email: "erika@example.org", country });
    const order = (option: string, country = "DE", sellerUserId: string | null = null) =>
      tx(db.pool, (c) => placeOrder(c, { ...base, sellerUserId, priceOptionId: opt[option]!, customer: consumer(country) }));
    let ref = 0;
    const pay = async (orderId: string, seq: number) => {
      const id = (await db.pool.query(`select id from app.order_installments where order_id = $1 and seq = $2`, [orderId, seq])).rows[0].id;
      return tx(db.pool, (c) => recordInstallmentPayment(c, { installmentId: id, provider: "stripe", providerRef: `pi_${++ref}`, paidAt: new Date(), issueDay: today }));
    };

    // 1) Einmalkauf DE, bezahlt, später erstattet.
    const a = await order("einmal");
    const inv = await pay(a.orderId, 1);
    const req = await tx(db.pool, (c) => requestRefund(c, admin, inv.invoiceId, "Widerruf"));
    await tx(db.pool, (c) => completeRefund(c, req.refundId, "re_1"));
    // 2) Ratenkauf AT über Vertrieb: zwei Raten bezahlt, dritte Einzug abgelehnt.
    const b = await order("raten", "AT", vId);
    await pay(b.orderId, 1);
    await pay(b.orderId, 2);
    const third = (await db.pool.query(`select id from app.order_installments where order_id = $1 and seq = 3`, [b.orderId])).rows[0].id;
    await tx(db.pool, (c) => recordChargeAttempt(c, { installmentId: third, provider: "stripe", providerRef: "pi_x", outcome: "abgelehnt", errorCode: "card_declined" }));
    // 3) Abo bezahlt.
    const c3 = await order("abo");
    await pay(c3.orderId, 1);
    // 4) Bestellung begonnen, nie bezahlt.
    await order("einmal");
  });
  after(() => db.drop());

  it("Admin: Umsatz aus Rechnungen, Erstattungen aus Stornos, Verkäufe und Folgezahlungen", async () => {
    const d = await dashboard(db.pool, admin, presetRange("30", today), today);
    const s = d.current;
    // Bruttopreise bleiben in jedem Land gleich: 119 + 2 × 50 + 69 €.
    assert.equal(s.revenueCents, 11900 + 5000 + 5000 + 6900);
    assert.equal(s.payments, 4);
    assert.equal(s.newSales, 3);
    assert.equal(s.newSalesCents, 11900 + 5000 + 6900);
    assert.equal(s.rebills, 1);
    assert.equal(s.rebillsCents, 5000);
    assert.equal(s.refunds, 1);
    assert.equal(s.refundsCents, 11900);
    assert.equal(s.failedPayments, 1);
    assert.equal(s.failedPaymentsCents, 5000);
    assert.equal(s.startedUnpaid, 1);
    assert.equal(d.before.revenueCents, 0);
    assert.equal(d.bucket, "tag");
    assert.equal(d.series.length, 30);
    assert.equal(d.series.at(-1)!.revenueCents, s.revenueCents);
    assert.equal(d.series.at(-1)!.refundsCents, 11900);
    assert.deepEqual(d.topProducts, [{ name: "Kurs", sales: 3, revenueCents: 28800 }]);
    assert.deepEqual(d.byCountry.map((c) => c.country).sort(), ["AT", "DE"]);
    assert.deepEqual(d.bySeller!.find((x) => x.seller === "Vera Vertrieb"), { seller: "Vera Vertrieb", sales: 1, revenueCents: 10000 });
    assert.equal(d.now.activeSubscriptions, 1);
    assert.equal(d.now.mrrCents, 6900);
    assert.equal(d.now.activePlans, 1);
    assert.equal(d.now.plansOutstandingCents, 5000);
    assert.deepEqual(d.legacy, { invoices: 0, revenueCents: 0 });
  });

  it("Vertrieb sieht nur eigene Verkäufe", async () => {
    const d = await dashboard(db.pool, vertrieb, presetRange("30", today), today);
    assert.equal(d.current.revenueCents, 10000);
    assert.equal(d.current.refunds, 0);
    assert.equal(d.bySeller, null);
    assert.equal(d.legacy, null);
    assert.equal(d.now.activeSubscriptions, 0);
  });

  it("längere Zeiträume werden je Monat gezeigt", async () => {
    const d = await dashboard(db.pool, admin, presetRange("365", today), today);
    assert.equal(d.bucket, "monat");
    assert.ok(d.series.length >= 12 && d.series.length <= 13);
    assert.equal(d.series.reduce((t, x) => t + x.revenueCents, 0), d.current.revenueCents);
  });
});
