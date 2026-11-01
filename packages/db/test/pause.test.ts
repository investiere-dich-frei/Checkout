import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dueCharges, extendSubscriptions, PauseError, pauseSubscription, resumeSubscription } from "../src/billing.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkt und Kundin, keine echten Daten.
describe("Abo pausieren", () => {
  let db: TestDb;
  let abo: PlaceOrderInput;
  let raten: PlaceOrderInput;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`);
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [company]);
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by) values ($1, 'Club', 'standard', true, now(), $2) returning id`,
      [company, admin],
    );
    const monthly = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Monatlich', 'abo', 4900, 'brutto', 4900, 1) returning id`,
      [product],
    );
    const plan = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '3 Raten', 'raten', 10000, 'brutto', 10000, 2, 3, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    abo = {
      priceOptionId: monthly,
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-09-15",
    };
    raten = { ...abo, priceOptionId: plan };
  });
  after(() => db.drop());

  const statuses = async (orderId: string) =>
    (await db.pool.query(`select due_date::text d, status from app.order_installments where order_id = $1 order by seq`, [orderId])).rows.map(
      (r) => `${r.d} ${r.status}`,
    );

  it("lässt Zahlungen in der Pause entfallen und setzt danach im alten Rhythmus fort", async () => {
    const { orderId } = await tx(db.pool, (c) => placeOrder(c, abo));
    await tx(db.pool, (c) => extendSubscriptions(c, "2026-12-31"));

    await assert.rejects(
      tx(db.pool, (c) => pauseSubscription(c, { orderId, startsOn: "2026-09-30", endsOn: null, actor: "user:t", today: "2026-10-01" })),
      PauseError,
    );
    const waived = await tx(db.pool, (c) =>
      pauseSubscription(c, { orderId, startsOn: "2026-10-01", endsOn: "2026-11-30", reason: "Elternzeit", actor: "user:t", today: "2026-10-01" }),
    );
    assert.equal(waived, 2);
    await assert.rejects(
      tx(db.pool, (c) => pauseSubscription(c, { orderId, startsOn: "2026-11-01", endsOn: null, actor: "user:t", today: "2026-10-01" })),
      /schon eine Pause/,
    );
    assert.deepEqual(await statuses(orderId), ["2026-09-15 offen", "2026-10-15 erlassen", "2026-11-15 erlassen", "2026-12-15 offen"]);
    assert.ok((await dueCharges(db.pool, "2026-11-20")).every((d) => d.orderId !== orderId || d.seq === 1));

    // Vorzeitig fortsetzen: Was ab heute fällig wird, ist wieder offen.
    assert.equal(await tx(db.pool, (c) => resumeSubscription(c, { orderId, actor: "user:t", today: "2026-11-10" })), true);
    assert.equal(await tx(db.pool, (c) => resumeSubscription(c, { orderId, actor: "user:t", today: "2026-11-10" })), false);
    assert.deepEqual(await statuses(orderId), ["2026-09-15 offen", "2026-10-15 erlassen", "2026-11-15 offen", "2026-12-15 offen"]);

    // Unbefristete Pause: Neue Fälligkeiten entstehen gleich als erlassen.
    await tx(db.pool, (c) => pauseSubscription(c, { orderId, startsOn: "2027-01-01", endsOn: null, actor: "user:t", today: "2026-12-20" }));
    await tx(db.pool, (c) => extendSubscriptions(c, "2027-02-28"));
    assert.deepEqual((await statuses(orderId)).slice(4), ["2027-01-15 erlassen", "2027-02-15 erlassen"]);
    await tx(db.pool, (c) => resumeSubscription(c, { orderId, actor: "user:t", today: "2027-02-20" }));
    await tx(db.pool, (c) => extendSubscriptions(c, "2027-03-31"));
    assert.deepEqual((await statuses(orderId)).slice(4), ["2027-01-15 erlassen", "2027-02-15 erlassen", "2027-03-15 offen"]);

    const hooks = (await db.pool.query(`select event_type from app.webhook_outbox where payload->'order'->>'order_id' = $1 order by created_at`, [orderId])).rows;
    assert.deepEqual(
      hooks.map((h) => h.event_type),
      ["abo.pausiert", "abo.fortgesetzt", "abo.pausiert", "abo.fortgesetzt"],
    );
  });

  it("hebt eine noch nicht begonnene Pause auf und hält Pausen fest", async () => {
    const { orderId } = await tx(db.pool, (c) => placeOrder(c, { ...abo, customer: { ...abo.customer, email: "zwei@example.org" } }));
    await tx(db.pool, (c) => extendSubscriptions(c, "2026-12-31"));
    await tx(db.pool, (c) => pauseSubscription(c, { orderId, startsOn: "2026-11-01", endsOn: "2026-12-31", actor: "user:t", today: "2026-10-01" }));
    await tx(db.pool, (c) => resumeSubscription(c, { orderId, actor: "user:t", today: "2026-10-05" }));
    assert.deepEqual(await statuses(orderId), ["2026-09-15 offen", "2026-10-15 offen", "2026-11-15 offen", "2026-12-15 offen"]);
    const p = (await db.pool.query(`select id, ends_on::text from app.subscription_pauses where order_id = $1`, [orderId])).rows[0];
    assert.equal(p.ends_on, "2026-10-31");
    await assert.rejects(db.pool.query(`update app.subscription_pauses set starts_on = '2026-12-01' where id = $1`, [p.id]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`update app.subscription_pauses set ends_on = '2026-12-31', ended_by = 'x' where id = $1`, [p.id]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`delete from app.subscription_pauses where id = $1`, [p.id]));
  });

  it("pausiert keine Ratenpläne", async () => {
    const { orderId } = await tx(db.pool, (c) => placeOrder(c, { ...raten, customer: { ...abo.customer, email: "raten@example.org" } }));
    await assert.rejects(
      tx(db.pool, (c) => pauseSubscription(c, { orderId, startsOn: "2026-10-01", endsOn: null, actor: "user:t", today: "2026-10-01" })),
      /Nur Abos/,
    );
  });
});
