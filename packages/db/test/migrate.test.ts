import assert from "node:assert/strict";
import { cp, mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { MIGRATIONS_DIR, migrate } from "../src/migrate.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

describe("Migrationen", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.drop());

  it("ist wiederholbar ohne Wirkung", async () => {
    const c = await db.pool.connect();
    try {
      assert.deepEqual(await migrate(c), []);
    } finally {
      c.release();
    }
  });

  it("bricht ab, wenn eine eingespielte Migration verändert wurde", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mig-"));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await appendFile(join(dir, "0001_grundlagen.sql"), "\n-- nachträglich geändert\n");
    const c = await db.pool.connect();
    try {
      await assert.rejects(migrate(c, dir), /Prüfsumme/);
    } finally {
      c.release();
    }
  });
});
