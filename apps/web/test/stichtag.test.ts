import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createTestDb, type TestDb } from "../../../packages/db/test/helpers.ts";
import { assertTestDatabase, parseStichtag } from "../lib/stichtag";

describe("Stichtag für den Einzug", () => {
  it("liest das Datum aus den Argumenten", () => {
    assert.equal(parseStichtag([]), null);
    assert.equal(parseStichtag(["--stichtag", "2026-12-01"]), "2026-12-01");
    assert.equal(parseStichtag(["--stichtag=2027-01-31"]), "2027-01-31");
    assert.throws(() => parseStichtag(["--stichtag"]), /JJJJ-MM-TT/);
    assert.throws(() => parseStichtag(["--stichtag", "01.12.2026"]), /JJJJ-MM-TT/);
    assert.throws(() => parseStichtag(["--stichtag", "2026-02-30"]), /Ungültiges Datum/);
  });

  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(async () => {
    await db.drop();
  });

  it("verlangt Testbetrieb bei allen Gesellschaften", async () => {
    await assert.rejects(assertTestDatabase(db.pool), /keine Gesellschaft/);
    const { rows } = await db.pool.query(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await assert.rejects(assertTestDatabase(db.pool), /nicht im Testbetrieb/);
    await db.pool.query(`update app.companies set payments_mode = 'test' where id = $1`, [rows[0].id]);
    await assertTestDatabase(db.pool);
  });

  it("lehnt eine Datenbank ohne „test“ im Namen ab", async () => {
    const fake = { query: async () => ({ rows: [{ db: "idf", companies: 1, live: 0 }] }) } as unknown as pg.Pool;
    await assert.rejects(assertTestDatabase(fake), /Testdatenbank erlaubt, diese heißt „idf“/);
  });
});
