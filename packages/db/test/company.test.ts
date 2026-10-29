import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createCompany, parseCompany, type CompanyInput } from "../src/company.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, keine echten Daten.
const input: CompanyInput = {
  legal_name: "Beispiel Akademie GmbH",
  street: "Musterweg 1",
  postal_code: "12345",
  city: "Musterstadt",
  vat_id: "DE000000000",
  register_info: "Amtsgericht Musterstadt HRB 1",
  invoice_prefix: "BA-",
  invoice_next_value: 1,
};

describe("Gesellschaft anlegen", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.drop());

  it("prüft die Pflichtfelder", () => {
    assert.throws(() => parseCompany({ ...input, city: "" }), /city/);
    assert.throws(() => parseCompany({ ...input, invoice_next_value: 0 }), /invoice_next_value/);
    assert.throws(() => parseCompany({ ...input, country: "Deutschland" }), /Ländercode/);
    assert.deepEqual(parseCompany(input), input);
  });

  it("legt Gesellschaft und Nummernkreis zusammen an und protokolliert die handelnde Stelle", async () => {
    const id = await tx(db.pool, (c) => createCompany(c, input, "cli:test"));
    const series = (await db.pool.query(`select prefix, next_value from app.invoice_number_series where company_id = $1`, [id]))
      .rows[0];
    assert.deepEqual(series, { prefix: "BA-", next_value: "1" });
    const actors = (
      await db.pool.query(
        `select distinct actor from app.audit_log where table_name in ('companies', 'invoice_number_series')`,
      )
    ).rows;
    assert.deepEqual(actors, [{ actor: "cli:test" }]);
  });

  it("legt dieselbe Gesellschaft nicht zweimal an", async () => {
    await assert.rejects(tx(db.pool, (c) => createCompany(c, input, "cli:test")), /gibt es schon/);
  });

  it("verlangt eine benannte handelnde Stelle", async () => {
    await assert.rejects(tx(db.pool, (c) => createCompany(c, { ...input, legal_name: "Andere GmbH" }, "")), /handelnde Stelle/);
  });
});
