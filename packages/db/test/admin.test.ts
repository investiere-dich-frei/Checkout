import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { listOrders, openWork, orderDetail, orderFilterOptions, resolveNotice, sellerLinks } from "../src/admin.ts";
import { endSession, redeemLogin, requestLogin, sessionUser, type SessionUser } from "../src/auth.ts";
import { submitNotice } from "../src/notices.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Nutzerinnen und Kundinnen, keine echten Daten.
describe("Verwaltung: Anmeldung und Sichtbarkeit", () => {
  let db: TestDb;
  let order: PlaceOrderInput;
  let aboOrder: PlaceOrderInput;
  let vertrieb: string;

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
    vertrieb = await q(`insert into app.users (email, display_name, role, sales_code) values ('vera@example.org', 'Vera', 'vertrieb', 'vera') returning id`);
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

  const linkFromMail = async () => {
    const body = (await db.pool.query(`select body_text from app.mail_outbox where purpose = 'anmeldung' order by created_at desc limit 1`)).rows[0].body_text as string;
    return /\/admin\/anmelden\/([A-Za-z0-9_-]+)/.exec(body)![1]!;
  };

  it("meldet per einmaligem Link an und speichert nur Hashes", async () => {
    assert.equal(await tx(db.pool, (c) => requestLogin(c, "unbekannt@example.org", "https://kasse.example.org")), false);
    assert.equal(await tx(db.pool, (c) => requestLogin(c, " VERA@example.org ", "https://kasse.example.org")), true);
    const token = await linkFromMail();
    const stored = (await db.pool.query(`select count(*)::int n from app.login_tokens where token_hash = convert_to($1, 'UTF8')`, [token])).rows[0].n;
    assert.equal(stored, 0);
    const s = await tx(db.pool, (c) => redeemLogin(c, token));
    assert.ok(s);
    assert.equal(await tx(db.pool, (c) => redeemLogin(c, token)), null);
    const user = await sessionUser(db.pool, s.session);
    assert.deepEqual({ ...user, id: undefined }, { id: undefined, email: "vera@example.org", displayName: "Vera", role: "vertrieb", salesCode: "vera" });
    await endSession(db.pool, s.session);
    assert.equal(await sessionUser(db.pool, s.session), null);
  });

  it("lässt abgelaufene Links nicht zu", async () => {
    await tx(db.pool, (c) => requestLogin(c, "vera@example.org", "https://x"));
    const token = await linkFromMail();
    await db.pool.query(`update app.login_tokens set expires_at = now() - interval '1 minute' where used_at is null`);
    assert.equal(await tx(db.pool, (c) => redeemLogin(c, token)), null);
  });

  it("zeigt dem Vertrieb nur eigene Bestellungen, Admins alles", async () => {
    const own = await tx(db.pool, (c) => placeOrder(c, { ...order, sellerUserId: vertrieb }));
    const other = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const vera: SessionUser = { id: vertrieb, email: "vera@example.org", displayName: "Vera", role: "vertrieb", salesCode: "vera" };
    const admin: SessionUser = { ...vera, id: "00000000-0000-0000-0000-000000000000", role: "admin" };
    assert.deepEqual((await listOrders(db.pool, vera)).map((o) => o.id), [own.orderId]);
    assert.equal((await listOrders(db.pool, admin)).length, 2);
    assert.equal(await orderDetail(db.pool, vera, other.orderId), null);
    const detail = (await orderDetail(db.pool, admin, other.orderId))!;
    assert.equal(detail.head.is_abo, true);
    assert.equal(detail.installments.length, 1);
    assert.equal((await listOrders(db.pool, admin, { search: "erika" })).length, 2);

    const links = await sellerLinks(db.pool, vera);
    assert.ok(links.every((l) => l.path.endsWith("?v=vera")));
  });

  it("filtert die Bestellliste nach Zeitraum, Lage, Land, Vertrieb und Zahlung", async () => {
    const admin: SessionUser = { id: "00000000-0000-0000-0000-000000000000", email: "a@example.org", displayName: "A", role: "admin", salesCode: null };
    const vera: SessionUser = { id: vertrieb, email: "vera@example.org", displayName: "Vera", role: "vertrieb", salesCode: "vera" };
    const all = await listOrders(db.pool, admin);
    assert.ok(all.length >= 2);
    const ids = async (f: Parameters<typeof listOrders>[2]) => (await listOrders(db.pool, admin, f)).map((o) => o.id).sort();
    const rows = (await db.pool.query(`select o.id, exists (select 1 from app.subscription_terms t where t.order_id = o.id) abo from app.orders o`)).rows;
    const aboIds = rows.filter((r) => r.abo).map((r) => r.id).sort();
    const ratenIds = rows.filter((r) => !r.abo).map((r) => r.id).sort();
    assert.deepEqual(await ids({ state: "abo" }), aboIds);
    assert.deepEqual(await ids({ state: "raten" }), ratenIds);
    assert.deepEqual(await ids({ state: "einmal" }), []);
    // Noch nichts bezahlt, Raten ab 2026-11-02 fällig: am 2026-12-15 überfällig, vorher nicht.
    assert.ok((await ids({ state: "ueberfaellig", today: "2026-12-15" })).length >= ratenIds.length);
    assert.deepEqual(await ids({ state: "ueberfaellig", today: "2025-01-01" }), []);
    assert.deepEqual(await ids({ country: "de" }), all.map((o) => o.id).sort());
    assert.deepEqual(await ids({ country: "AT" }), []);
    assert.deepEqual(await ids({ payment: "keine" }), all.map((o) => o.id).sort());
    assert.deepEqual(await ids({ payment: "stripe" }), []);
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    assert.equal((await ids({ from: today, to: today })).length, all.length);
    assert.deepEqual(await ids({ to: "2020-01-01" }), []);
    // Unsinnige Werte werden ignoriert statt zu Fehlern zu führen.
    assert.equal((await ids({ from: "gestern", productId: "x", sellerId: "y" })).length, all.length);
    const veraOrders = (await listOrders(db.pool, vera)).map((o) => o.id).sort();
    assert.deepEqual(await ids({ sellerId: vertrieb }), veraOrders);
    // Der Vertrieb kann über den Filter keine fremden Bestellungen sehen.
    assert.deepEqual((await listOrders(db.pool, vera, { sellerId: "00000000-0000-0000-0000-000000000000" })).map((o) => o.id).sort(), veraOrders);
    const opts = await orderFilterOptions(db.pool, admin);
    assert.deepEqual(opts.countries, ["DE"]);
    assert.ok(opts.sellers.some((s) => s.id === vertrieb));
    assert.equal((await orderFilterOptions(db.pool, vera)).sellers.length, 0);
  });

  it("führt offene Kündigungen, bis ein Admin sie erledigt", async () => {
    const adminId = (await db.pool.query(`select id from app.users where role = 'admin'`)).rows[0].id;
    const admin: SessionUser = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    const n = await tx(db.pool, (c) => submitNotice(c, { kind: "kuendigung", fullName: "Erika Muster", email: "erika@example.org", contractReference: "Coaching", cancellationType: "ordentlich" }));
    assert.equal((await openWork(db.pool)).notices.length, 1);
    const vera: SessionUser = { ...admin, role: "vertrieb" };
    await assert.rejects(tx(db.pool, (c) => resolveNotice(c, vera, n.id, "x", null)));
    await tx(db.pool, (c) => resolveNotice(c, admin, n.id, "Abo zum 28.02. beendet", null));
    assert.equal((await openWork(db.pool)).notices.length, 0);
    await assert.rejects(tx(db.pool, (c) => resolveNotice(c, admin, n.id, "nochmal", null)));
  });
});
