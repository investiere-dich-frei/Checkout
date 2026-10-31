import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { extendSubscriptions } from "../src/billing.ts";
import { createCoupon, findCoupon, getCoupon, listCoupons, setCouponActive, updateCoupon, CouponError, type CouponInput } from "../src/coupons.ts";
import { recordInstallmentPayment } from "../src/invoicing.ts";
import { CouponRejected, placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Gutscheine", () => {
  let db: TestDb;
  let admin: SessionUser;
  let vertrieb: SessionUser;
  let base: Omit<PlaceOrderInput, "priceOptionId" | "customer">;
  const opt: Record<string, string> = {};
  const prod: Record<string, string> = {};

  const input = (p: Partial<CouponInput>): CouponInput => ({
    code: "TEST10",
    label: "",
    kind: "prozent",
    percentBp: 1000,
    amountCents: null,
    scope: "erste",
    allProducts: true,
    productIds: [],
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    ...p,
  });
  const create = (p: Partial<CouponInput>) => tx(db.pool, (c) => createCoupon(c, admin, null, input(p)));
  const consumer = { kind: "privat" as const, first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" };
  const order = (option: string, couponCode: string | null) =>
    tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: opt[option]!, customer: consumer, couponCode }));

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const vId = await q(`insert into app.users (email, display_name, role) values ('v@example.org', 'Vertrieb', 'vertrieb') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    vertrieb = { id: vId, email: "v@example.org", displayName: "Vertrieb", role: "vertrieb", salesCode: null };
    const product = (name: string, category: string) =>
      q(
        `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
         values ($1, $2, $3, true, now(), $4) returning id`,
        [companyId, name, category, adminId],
      );
    prod.kurs = await product("Kurs", "standard");
    prod.coaching = await product("Coaching", "steuerfrei_4_21");
    opt.einmal = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Einmal', 'einmal', 10000, 'brutto') returning id`,
      [prod.kurs],
    );
    opt.netto = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Netto', 'einmal', 10000, 'netto') returning id`,
      [prod.kurs],
    );
    opt.raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 5000, 'brutto', 5000, 2, 3, 1) returning id`,
      [prod.kurs],
    );
    opt.abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Abo', 'abo', 6900, 'brutto', 6900, 1) returning id`,
      [prod.kurs],
    );
    opt.coaching = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Einmal', 'einmal', 50000, 'netto') returning id`,
      [prod.coaching],
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
      purchaseDay: "2026-11-02",
    };
  });
  after(() => db.drop());

  it("nur Admins legen an; Code wird vereinheitlicht und ist eindeutig", async () => {
    await assert.rejects(tx(db.pool, (c) => createCoupon(c, vertrieb, null, input({}))), /Keine Berechtigung/);
    const id = await create({ code: " herbst10 " });
    const k = await getCoupon(db.pool, admin, id);
    assert.equal(k!.code, "HERBST10");
    await assert.rejects(create({ code: "HERBST10" }), (e: Error) => e instanceof CouponError && /gibt es schon/.test(e.message));
    await assert.rejects(create({ code: "X" }), CouponError);
    await assert.rejects(create({ code: "OHNE", percentBp: 10000 }), CouponError);
    await assert.rejects(create({ code: "LEER", allProducts: false, productIds: [] }), /mindestens ein Produkt/);
  });

  it("Brutto-Preis: Rabatt mindert den Bruttobetrag, Steuer wird aus dem neuen Betrag gerechnet", async () => {
    await create({ code: "ZEHN" });
    const r = await order("einmal", "zehn");
    assert.deepEqual(r.installments.map((i) => [i.netCents, i.taxCents, i.grossCents]), [[7563, 1437, 9000]]);
    assert.deepEqual(r.coupon, { code: "ZEHN", discountGrossCents: 1000 });
    const d = (await db.pool.query(`select list_gross_cents, discount_gross_cents, amount_basis from app.order_discounts where order_id = $1`, [r.orderId])).rows[0];
    assert.equal(Number(d.list_gross_cents), 10000);
    assert.equal(d.amount_basis, "brutto");
    const o = (await db.pool.query(`select total_gross_cents from app.orders where id = $1`, [r.orderId])).rows[0];
    assert.equal(Number(o.total_gross_cents), 9000);
  });

  it("Netto-Preis mit festem Betrag; steuerfreies Produkt bleibt steuerfrei", async () => {
    await create({ code: "MINUS20", kind: "betrag", percentBp: null, amountCents: 2000 });
    const r = await order("netto", "MINUS20");
    assert.deepEqual(r.installments.map((i) => [i.netCents, i.taxCents, i.grossCents]), [[8000, 1520, 9520]]);
    assert.equal(r.coupon!.discountGrossCents, 2380);
    const c = await order("coaching", "MINUS20");
    assert.equal(c.tax.rule, "de_exempt_4_21");
    assert.deepEqual(c.installments.map((i) => [i.netCents, i.taxCents, i.grossCents]), [[48000, 0, 48000]]);
  });

  it("Raten: erste Zahlung oder alle Zahlungen", async () => {
    await create({ code: "ERSTE", kind: "betrag", percentBp: null, amountCents: 1000 });
    await create({ code: "ALLE", scope: "alle" });
    const a = await order("raten", "ERSTE");
    assert.deepEqual(a.installments.map((i) => i.grossCents), [4000, 5000, 5000]);
    assert.equal(a.coupon!.discountGrossCents, 1000);
    const b = await order("raten", "ALLE");
    assert.deepEqual(b.installments.map((i) => i.grossCents), [4500, 4500, 4500]);
    assert.equal(b.coupon!.discountGrossCents, 1500);
  });

  it("Abo: bei „alle“ gilt der Rabatt auch für Verlängerungen, bei „erste“ nur einmal", async () => {
    const alle = await order("abo", "ALLE");
    const erste = await order("abo", "ERSTE");
    await tx(db.pool, (c) => extendSubscriptions(c, "2027-01-02"));
    const amounts = async (orderId: string) =>
      (await db.pool.query(`select gross_cents from app.order_installments where order_id = $1 order by seq`, [orderId])).rows.map((r) => Number(r.gross_cents));
    assert.deepEqual(await amounts(alle.orderId), [6210, 6210, 6210]);
    assert.deepEqual(await amounts(erste.orderId), [5900, 6900, 6900]);
  });

  it("Rechnung: Betrag mit Rabatt, Hinweis auf den Gutschein nur bei geminderten Zahlungen", async () => {
    const r = await order("raten", "ERSTE");
    const inst = (await db.pool.query(`select id from app.order_installments where order_id = $1 order by seq`, [r.orderId])).rows;
    const pay = (id: string, ref: string) =>
      tx(db.pool, (c) => recordInstallmentPayment(c, { installmentId: id, provider: "stripe", providerRef: ref, paidAt: new Date(), issueDay: "2026-11-02" }));
    const first = await pay(inst[0].id, "pi_k1");
    const second = await pay(inst[1].id, "pi_k2");
    const desc = async (invoiceId: string) =>
      (await db.pool.query(`select description, gross_cents from app.invoice_items where invoice_id = $1`, [invoiceId])).rows[0];
    const d1 = await desc(first.invoiceId);
    assert.match(d1.description, /Zahlung 1 von 3\) · Gutschein ERSTE: 10,00\s€ Rabatt enthalten/);
    assert.equal(Number(d1.gross_cents), 4000);
    const d2 = await desc(second.invoiceId);
    assert.doesNotMatch(d2.description, /Gutschein/);
  });

  it("Produktauswahl, Zeitraum, Limit und Abschalten", async () => {
    await create({ code: "NURCOACH", allProducts: false, productIds: [prod.coaching!] });
    assert.deepEqual(await findCoupon(db.pool, "NURCOACH", opt.einmal!), { ok: false, message: "Dieser Gutschein gilt nicht für dieses Angebot." });
    assert.equal((await findCoupon(db.pool, "nurcoach", opt.coaching!)).ok, true);

    await create({ code: "SPAETER", validFrom: "2099-01-01" });
    assert.match((await findCoupon(db.pool, "SPAETER", opt.einmal!) as { message: string }).message, /noch nicht/);
    await create({ code: "VORBEI", validFrom: "2020-01-01", validUntil: "2020-01-31" });
    assert.match((await findCoupon(db.pool, "VORBEI", opt.einmal!) as { message: string }).message, /abgelaufen/);

    const einmalig = await create({ code: "EINMAL", maxRedemptions: 1 });
    await order("einmal", "EINMAL");
    await assert.rejects(order("einmal", "EINMAL"), (e: Error) => e instanceof CouponRejected && /vollständig eingelöst/.test(e.message));
    // Stornierte Bestellungen geben das Limit wieder frei.
    await db.pool.query(
      `update app.orders set status = 'storniert' where id in (select order_id from app.order_discounts where coupon_id = $1)`,
      [einmalig],
    );
    assert.equal((await findCoupon(db.pool, "EINMAL", opt.einmal!)).ok, true);

    await tx(db.pool, (c) => setCouponActive(c, admin, einmalig, false));
    assert.equal((await findCoupon(db.pool, "EINMAL", opt.einmal!)).ok, false);
    await assert.rejects(order("einmal", "GIBTESNICHT"), /kennen wir nicht/);
  });

  it("Rabatt, der eine Zahlung unter 1 € drückt, wird abgelehnt", async () => {
    await create({ code: "ZUVIEL", kind: "betrag", percentBp: null, amountCents: 9950 });
    await assert.rejects(order("einmal", "ZUVIEL"), CouponRejected);
  });

  it("GoBD: eingelöste Gutscheine bleiben in Code und Rabatt fest, nichts wird gelöscht", async () => {
    const k = (await listCoupons(db.pool, admin)).find((c) => c.code === "ZEHN")!;
    assert.equal(k.locked, true);
    assert.equal(k.redemptions, 1);
    assert.equal(k.discountCents, 1000);
    await assert.rejects(tx(db.pool, (c) => updateCoupon(c, admin, k.id, input({ code: "ZEHN", percentBp: 2000 }))), /bereits eingelöst|schon eingelöst/);
    // Zeitraum und Limit bleiben änderbar.
    await tx(db.pool, (c) => updateCoupon(c, admin, k.id, input({ code: "ZEHN", maxRedemptions: 50, validUntil: "2099-12-31" })));
    assert.equal((await getCoupon(db.pool, admin, k.id))!.maxRedemptions, 50);
    await assert.rejects(db.pool.query(`delete from app.coupons where id = $1`, [k.id]));
    await assert.rejects(db.pool.query(`update app.order_discounts set discount_gross_cents = 0`));
    await assert.rejects(db.pool.query(`delete from app.order_discounts`));
  });
});
