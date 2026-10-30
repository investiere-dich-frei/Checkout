import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { applyGrants } from "../src/grants.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

// Prüft die Rechte der Anwendungsrolle in einer frischen Testdatenbank.
describe("Rechte der Anwendungsrolle", () => {
  let db: TestDb;
  let app: pg.Client;

  before(async () => {
    db = await createTestDb();
    await db.pool.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'idf_app') then create role idf_app login password 'nur_test'; end if; end $$`);
    const c = await db.pool.connect();
    try {
      await applyGrants(c);
      await applyGrants(c);
    } finally {
      c.release();
    }
    const url = new URL(db.url);
    url.username = "idf_app";
    url.password = "nur_test";
    app = new pg.Client({ connectionString: url.toString() });
    await app.connect();
  });
  after(async () => {
    await app.end();
    await db.drop();
  });

  it("darf lesen und schreiben, aber nichts löschen und das Audit-Log nicht anfassen", async () => {
    const c = await app.query(`insert into app.companies (legal_name, street, postal_code, city) values ('T', 'S', '1', 'B') returning id`);
    assert.equal(c.rowCount, 1);
    await app.query(`update app.companies set city = 'Berlin' where id = $1`, [c.rows[0].id]);
    await assert.rejects(app.query(`delete from app.companies`), /permission denied/);
    await assert.rejects(app.query(`insert into app.audit_log (actor) values ('x')`), /permission denied/);
    await assert.rejects(app.query(`update app.audit_log set actor = 'x'`), /permission denied/);
    assert.ok((await app.query(`select count(*) from app.audit_log`)).rows[0].count > 0);
    await assert.rejects(app.query(`insert into legacy.thrivecart_invoices (invoice_number, issuer_name, issued_at, currency, source_kind) values (1, 'x', now(), 'EUR', 'kauf')`), /permission denied/);
    await assert.rejects(app.query(`select * from public.schema_migrations`), /permission denied/);
    await assert.rejects(app.query(`alter table app.invoices disable trigger all`), /must be owner/);
  });
});
