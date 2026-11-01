import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { takeoverOverview, takeoverRoute } from "../src/takeover.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

// Ausgedachte Abos, keine echten Daten.
describe("Abo-Umzug: Übersicht", () => {
  let db: TestDb;
  const admin: SessionUser = { id: "00000000-0000-0000-0000-000000000001", email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };

  before(async () => {
    db = await createTestDb();
    await db.pool.query(
      `insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind)
       select n, 'Test GmbH', '2025-01-01', 'EUR', 'abo' from generate_series(1, 5) n`,
    );
    await db.pool.query(
      `insert into legacy.thrivecart_subscriptions (subscription_id, invoice_number, email, status, processor, remote_subscription_id, amount_cents, payments_remaining, next_payment_at, source_row)
       values (1, 1, 'a@example.org', 'active', 'paypal_v2', 'I-TEST1', 9900, null, '2026-12-01', '{"item_name": "Club"}'),
              (2, 2, 'b@example.org', 'paused', 'paypal_v2', 'I-TEST2', 9900, null, null, '{}'),
              (3, 3, 'c@example.org', 'active', 'thrivepay', null, 25000, 2, '2026-11-15', '{}'),
              (4, 4, 'd@example.org', 'Active', 'stripe_v2', 'sub_test', 4900, null, '2026-11-20', '{}'),
              (5, 5, 'e@example.org', 'cancelled', 'stripe_v2', 'sub_alt', 4900, null, null, '{}')`,
    );
  });
  after(() => db.drop());

  it("ordnet Zahlungswege zu", () => {
    assert.equal(takeoverRoute("paypal_v2"), "paypal");
    assert.equal(takeoverRoute("thrivepay"), "thrivepay");
    assert.equal(takeoverRoute("stripe_v2"), "stripe");
    assert.equal(takeoverRoute(null), "unbekannt");
  });

  it("zählt nur laufende Abos, je Weg", async () => {
    const d = (await takeoverOverview(db.pool, admin))!;
    const by = Object.fromEntries(d.summary.map((s) => [s.route, s]));
    assert.equal(d.rows.length, 4);
    assert.deepEqual([by.paypal!.count, by.paypal!.paused], [2, 1]);
    assert.deepEqual([by.thrivepay!.count, by.thrivepay!.withoutRef, by.thrivepay!.endingSoon], [1, 1, 1]);
    assert.equal(by.stripe!.count, 1);
    assert.equal(d.rows[0]!.subscriptionId, "3");
    assert.equal((await takeoverOverview(db.pool, admin, { route: "paypal" }))!.rows.length, 2);
    assert.equal(await takeoverOverview(db.pool, { ...admin, role: "vertrieb" }), null);
  });
});
