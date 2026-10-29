import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { OrderError, placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Bestellung aufgeben", () => {
  let db: TestDb;
  let base: Omit<PlaceOrderInput, "priceOptionId" | "customer">;
  const options: Record<string, string> = {};

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const seller = await q(`insert into app.users (email, display_name, role) values ('v@example.org', 'Vertrieb', 'vertrieb') returning id`);
    const product = (name: string, category: string, active = true) =>
      q(
        `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
         values ($1, $2, $3, $4, case when $4 then now() end, case when $4 then $5::uuid end) returning id`,
        [companyId, name, category, active, admin],
      );
    const coaching = await product("Coaching", "steuerfrei_4_21");
    const kurs = await product("Kurs", "standard");
    const gesperrt = await product("Ungeprüft", "standard", false);

    options.einmal = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Einmal', 'einmal', 499700, 'netto') returning id`,
      [coaching],
    );
    options.raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 3109, 'netto', 3109, 2, 3, 1) returning id`,
      [kurs],
    );
    options.abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Abo', 'abo', 9900, 'brutto', 9900, 1) returning id`,
      [kurs],
    );
    options.gesperrt = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents) values ($1, 'X', 'einmal', 100) returning id`,
      [gesperrt],
    );

    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(
        await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]),
      );
    }
    base = {
      vatIdVerified: false,
      sellerUserId: seller,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-11-30",
    };
  });
  after(() => db.drop());

  const consumer = (country: string) => ({ kind: "privat" as const, first_name: "Erika", last_name: "Muster", email: "erika@example.org", country });

  it("Deutschland, § 4 Nr. 21: steuerfrei mit Hinweis, eine Fälligkeit", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.einmal!, customer: consumer("DE") }));
    assert.equal(r.tax.rule, "de_exempt_4_21");
    assert.deepEqual(r.installments, [{ seq: 1, dueDate: "2026-11-30", netCents: 499700, taxCents: 0, grossCents: 499700 }]);
    const item = (await db.pool.query(`select tax_rate_bp, tax_note, gross_cents from app.order_items where id = $1`, [r.orderItemId])).rows[0];
    assert.equal(item.tax_rate_bp, 0);
    assert.match(item.tax_note, /§ 4 Nr. 21/);
    const order = (await db.pool.query(`select status, seller_user_id, withdrawal_waiver_at from app.orders where id = $1`, [r.orderId])).rows[0];
    assert.equal(order.status, "offen");
    assert.equal(order.seller_user_id, base.sellerUserId);
    assert.ok(order.withdrawal_waiver_at);
  });

  it("Österreich: dasselbe Produkt mit 20 %", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.einmal!, customer: consumer("AT") }));
    assert.equal(r.tax.rateBp, 2000);
    assert.equal(r.installments[0]!.grossCents, 599640);
  });

  it("Raten: alle Fälligkeiten werden festgeschrieben, Monatsende bleibt", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.raten!, customer: consumer("DE") }));
    assert.deepEqual(
      r.installments.map((i) => [i.dueDate, i.grossCents]),
      [["2026-11-30", 3700], ["2026-12-30", 3700], ["2027-01-30", 3700]],
    );
    const total = (await db.pool.query(`select total_gross_cents from app.orders where id = $1`, [r.orderId])).rows[0];
    assert.equal(total.total_gross_cents, "11100");
  });

  it("Abo mit Bruttopreis: erste Fälligkeit, Brutto bleibt exakt", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.abo!, customer: consumer("DE") }));
    assert.deepEqual(r.installments, [{ seq: 1, dueDate: "2026-11-30", netCents: 8319, taxCents: 1581, grossCents: 9900 }]);
  });

  it("Reverse Charge nur mit geprüfter USt-IdNr.", async () => {
    const firm = { kind: "unternehmen" as const, company_name: "Firma", email: "f@example.org", country: "AT", vat_id: "ATU00000000" };
    const unchecked = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.raten!, customer: firm }));
    assert.equal(unchecked.tax.rateBp, 2000);
    const checked = await tx(db.pool, (c) => placeOrder(c, { ...base, vatIdVerified: true, priceOptionId: options.raten!, customer: firm }));
    assert.equal(checked.tax.rule, "eu_reverse_charge");
  });

  it("verkauft keine ungeprüften Produkte", async () => {
    await assert.rejects(
      tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.gesperrt!, customer: consumer("DE") })),
      OrderError,
    );
  });

  it("verlangt die passenden Rechtstexte", async () => {
    await assert.rejects(
      tx(db.pool, (c) =>
        placeOrder(c, { ...base, agbVersionId: base.privacyVersionId, priceOptionId: options.einmal!, customer: consumer("DE") }),
      ),
      /Rechtstexte/,
    );
  });

  it("Fälligkeiten und Positionen sind festgeschrieben, nur der Status ändert sich", async () => {
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: options.raten!, customer: consumer("DE") }));
    await assert.rejects(db.pool.query(`update app.order_installments set gross_cents = 1 where order_id = $1`, [r.orderId]), /GoBD/);
    await assert.rejects(db.pool.query(`update app.order_installments set due_date = '2030-01-01' where order_id = $1`, [r.orderId]), /GoBD/);
    await assert.rejects(db.pool.query(`delete from app.order_installments where order_id = $1`, [r.orderId]), /GoBD/);
    await assert.rejects(db.pool.query(`update app.order_items set tax_rate_bp = 0 where id = $1`, [r.orderItemId]), /GoBD/);
    await db.pool.query(`update app.order_installments set status = 'erlassen' where order_id = $1 and seq = 3`, [r.orderId]);
    const { rows } = await db.pool.query(`select * from app.audit_verify()`);
    assert.deepEqual(rows, []);
  });
});
