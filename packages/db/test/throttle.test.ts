import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hit } from "../src/throttle.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

describe("Zähler gegen Massenbestellungen", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.drop());

  it("zählt je Bereich und Schlüssel getrennt hoch", async () => {
    const a = Buffer.alloc(32, 1);
    const b = Buffer.alloc(32, 2);
    assert.equal(await hit(db.pool, "bestellung_ip", a), 1);
    assert.equal(await hit(db.pool, "bestellung_ip", a), 2);
    assert.equal(await hit(db.pool, "bestellung_ip", b), 1);
    assert.equal(await hit(db.pool, "bestellung_email", a), 1);
    const stored = (await db.pool.query(`select count(*)::int as n from app.request_counters`)).rows[0].n;
    assert.equal(stored, 3);
  });

  it("lehnt unbekannte Bereiche ab", async () => {
    await assert.rejects(hit(db.pool, "unbekannt" as never, Buffer.alloc(32)), /check constraint/);
  });
});
