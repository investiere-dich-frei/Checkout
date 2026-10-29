import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestDb, issueInvoice, seed, tx, type Fixture, type TestDb } from "./helpers.ts";

describe("Audit-Trail", () => {
  let db: TestDb;
  let f: Fixture;

  before(async () => {
    db = await createTestDb();
    f = await seed(db.pool);
  });
  after(() => db.drop());

  it("protokolliert jede Änderung mit handelnder Person", async () => {
    await tx(db.pool, async (c) => {
      await c.query("set local app.actor = 'user:vertrieb-1'");
      await c.query("update app.orders set status = 'storniert' where id = $1", [f.orderId]);
    });
    const row = (
      await db.pool.query(
        "select actor, action, old_data->>'status' old, new_data->>'status' new from app.audit_log where table_name = 'orders' and action = 'UPDATE'",
      )
    ).rows[0];
    assert.deepEqual(row, { actor: "user:vertrieb-1", action: "UPDATE", old: "bezahlt", new: "storniert" });
  });

  it("hält die Hash-Kette intakt", async () => {
    await tx(db.pool, (c) => issueInvoice(c, f));
    const { rows } = await db.pool.query("select * from app.audit_verify()");
    assert.deepEqual(rows, []);
  });

  it("verbietet Ändern und Löschen von Protokollzeilen", async () => {
    await assert.rejects(db.pool.query("update app.audit_log set actor = 'x'"), /GoBD/);
    await assert.rejects(db.pool.query("delete from app.audit_log"), /GoBD/);
    await assert.rejects(db.pool.query("truncate app.audit_log"), /GoBD/);
  });

  it("erkennt Manipulation auch dann, wenn jemand die Trigger umgeht", async () => {
    const c = await db.pool.connect();
    try {
      // So könnte nur ein Superuser vorgehen; genau das soll die Kette aufdecken.
      await c.query("set session_replication_role = replica");
      await c.query("update app.audit_log set actor = 'gefälscht' where id = 2");
      await c.query("set session_replication_role = origin");
    } finally {
      c.release();
    }
    const { rows } = await db.pool.query("select * from app.audit_verify()");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].broken_id, "2");
    assert.match(rows[0].reason, /verändert/);
  });
});
