import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  addLegalVersion,
  ibanChecksumOk,
  legalVersions,
  listCompanySettings,
  parsePercentBp,
  updateCompanySettings,
  type CompanyUpdate,
} from "../src/settings.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft und Texte, keine echten Daten.
describe("Einstellungen in der Verwaltung", () => {
  let db: TestDb;
  let companyId: string;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const base: CompanyUpdate = {
    legalName: "Beispiel GmbH",
    street: "Musterweg 2",
    postalCode: "20095",
    city: "Hamburg",
    country: "de",
    vatId: "DE 123456789",
    taxNumber: "",
    registerInfo: "",
    bankName: "Testbank",
    iban: "DE89 3704 0044 0532 0130 00",
    bic: "cobadeffxxx",
    chVatRate: "8,1",
  };

  before(async () => {
    db = await createTestDb();
    companyId = (
      await db.pool.query(`insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`)
    ).rows[0].id;
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 5)`, [companyId]);
  });
  after(() => db.drop());

  it("liest Prozent und IBAN-Prüfziffer", () => {
    assert.equal(parsePercentBp("8,1"), 810);
    assert.equal(parsePercentBp("19 %"), 1900);
    assert.equal(parsePercentBp(" "), null);
    assert.throws(() => parsePercentBp("abc"));
    assert.throws(() => parsePercentBp("0"));
    assert.equal(ibanChecksumOk("DE89370400440532013000"), true);
    assert.equal(ibanChecksumOk("DE89370400440532013001"), false);
  });

  it("ändert Firmendaten mit Prüfung und Audit-Log; Nummernkreis bleibt", async () => {
    await assert.rejects(tx(db.pool, (c) => updateCompanySettings(c, companyId, { ...base, city: " " })), /Ort fehlt/);
    await assert.rejects(tx(db.pool, (c) => updateCompanySettings(c, companyId, { ...base, iban: "DE89370400440532013001" })), /Prüfziffer/);
    await assert.rejects(tx(db.pool, (c) => updateCompanySettings(c, companyId, { ...base, bic: "XX" })), /BIC/);
    await tx(db.pool, async (c) => {
      await c.query(`select set_config('app.actor', 'user:test', true)`);
      await updateCompanySettings(c, companyId, base);
    });
    const [s] = await listCompanySettings(db.pool);
    assert.equal(s!.legalName, "Beispiel GmbH");
    assert.equal(s!.country, "DE");
    assert.equal(s!.vatId, "DE123456789");
    assert.equal(s!.iban, "DE89370400440532013000");
    assert.equal(s!.bic, "COBADEFFXXX");
    assert.equal(s!.chVatRateBp, 810);
    assert.equal(s!.invoicePrefix, "T-");
    assert.equal(s!.invoiceNextValue, 5);
    const audit = (await db.pool.query(`select actor from app.audit_log where table_name = 'companies' order by id desc limit 1`)).rows[0];
    assert.equal(audit.actor, "user:test");
  });

  it("legt Rechtstexte als neue Fassung an, nie überschreibend", async () => {
    const text = "Allgemeine Geschäftsbedingungen. ".repeat(10);
    const add = (input: Partial<Parameters<typeof addLegalVersion>[1]>) =>
      tx(db.pool, (c) => addLegalVersion(c, { kind: "agb", version: "1", content: text, validFromDay: today, today, ...input }));
    await assert.rejects(add({ kind: "impressum" }), /Unbekannte/);
    await assert.rejects(add({ content: "zu kurz" }), /zu kurz/);
    await assert.rejects(add({ validFromDay: "2020-01-01" }), /frühestens heute/);
    await add({});
    await assert.rejects(add({}), /gibt es schon/);
    await assert.rejects(add({ version: "1b" }), /identisch/);
    await add({ version: "2", content: `${text} Neu.`, validFromDay: "2099-01-01" });
    const v = (await legalVersions(db.pool)).filter((x) => x.kind === "agb" && ["1", "2"].includes(x.version));
    assert.deepEqual(v.map((x) => [x.version, x.state]), [["2", "geplant"], ["1", "gilt"]]);
    await assert.rejects(db.pool.query(`update app.legal_text_versions set content = 'x' where kind = 'agb'`));
  });
});
