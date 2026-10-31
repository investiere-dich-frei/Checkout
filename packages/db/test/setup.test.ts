import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { confirmTaxCategories, parseTaxFile, parseUsers, setPaymentsMode, setSwissVatRate, upsertUsers } from "../src/setup.ts";
import { createTestDb, seed, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Personen und Produkte, keine echten Daten.
describe("Einrichtung vor dem ersten Verkauf", () => {
  let db: TestDb;
  let companyId: string;
  before(async () => {
    db = await createTestDb();
    ({ companyId } = await seed(db.pool, 1));
    for (const [tc, status] of [[901, "live"], [902, "live"], [903, "test"], [904, "live"]] as const) {
      await db.pool.query(
        `insert into app.products (company_id, name, tax_category, thrivecart_product_id, source_status)
         values ($1, $2, 'standard', $3, $4)`,
        [companyId, `Kurs ${tc}`, tc, status],
      );
    }
  });
  after(() => db.drop());

  it("prüft die Liste der Zugänge", () => {
    assert.throws(() => parseUsers([]), /nicht leere Liste/);
    assert.throws(() => parseUsers([{ email: "a@beispiel.de", display_name: "A", role: "chef" }]), /Rolle/);
    assert.throws(() => parseUsers([{ email: "a@beispiel.de", role: "admin" }]), /display_name/);
  });

  it("legt Admin-Zugänge an und aktualisiert sie beim zweiten Lauf", async () => {
    const users = parseUsers([
      { email: "Anna.Admin@Beispiel.de", display_name: "Anna Admin", role: "admin" },
      { email: "bert@beispiel.de", display_name: "Bert", role: "vertrieb", sales_code: "bert" },
    ]);
    assert.equal(await tx(db.pool, (c) => upsertUsers(c, users, "cli:test")), 2);
    await tx(db.pool, (c) => upsertUsers(c, [{ email: "bert@beispiel.de", display_name: "Bert B.", role: "admin" }], "cli:test"));
    const rows = (await db.pool.query(`select email, display_name, role, sales_code from app.users order by email`)).rows;
    assert.deepEqual(rows, [
      { email: "anna.admin@beispiel.de", display_name: "Anna Admin", role: "admin", sales_code: null },
      { email: "bert@beispiel.de", display_name: "Bert B.", role: "admin", sales_code: "bert" },
    ]);
    const actors = (await db.pool.query(`select distinct actor from app.audit_log where table_name = 'users'`)).rows;
    assert.deepEqual(actors, [{ actor: "cli:test" }]);
  });

  it("bestätigt Steuerkategorien im Namen einer Admin-Person und schaltet nur Live-Produkte frei", async () => {
    const decisions = parseTaxFile({
      entscheidungen: [
        { thrivecart_product_id: 901, tax_category: "steuerfrei_4_21", source: "Thrivecart-Steuertabelle" },
        { thrivecart_product_id: 903, tax_category: "standard", source: "Thrivecart-Bestellungen" },
        { thrivecart_product_id: 999, tax_category: "standard", source: "Thrivecart-Bestellungen" },
      ],
    });
    const r = await tx(db.pool, (c) => confirmTaxCategories(c, decisions, "ANNA.ADMIN@beispiel.de"));
    assert.deepEqual(r, { confirmed: 2, activated: 1, unknown: [999] });

    const rows = (
      await db.pool.query(
        `select p.thrivecart_product_id::int tc, p.tax_category, p.active, p.tax_source, u.email confirmed_by
           from app.products p left join app.users u on u.id = p.tax_confirmed_by
          where p.thrivecart_product_id is not null order by 1`,
      )
    ).rows;
    assert.deepEqual(rows, [
      { tc: 901, tax_category: "steuerfrei_4_21", active: true, tax_source: "Thrivecart-Steuertabelle", confirmed_by: "anna.admin@beispiel.de" },
      { tc: 902, tax_category: "standard", active: false, tax_source: null, confirmed_by: null },
      { tc: 903, tax_category: "standard", active: false, tax_source: "Thrivecart-Bestellungen", confirmed_by: "anna.admin@beispiel.de" },
      { tc: 904, tax_category: "standard", active: false, tax_source: null, confirmed_by: null },
    ]);

    // Ein zweiter Lauf ändert bereits bestätigte Produkte nicht.
    const again = await tx(db.pool, (c) =>
      confirmTaxCategories(c, [{ thrivecart_product_id: 901, tax_category: "standard", source: "anders" }], "anna.admin@beispiel.de"),
    );
    assert.deepEqual(again, { confirmed: 0, activated: 0, unknown: [] });
    const cat = (await db.pool.query(`select tax_category from app.products where thrivecart_product_id = 901`)).rows[0];
    assert.equal(cat.tax_category, "steuerfrei_4_21");
  });

  it("übernimmt die Preisart aus Thrivecart für die Preisoptionen des Produkts", async () => {
    const product = (await db.pool.query(`select id from app.products where thrivecart_product_id = 904`)).rows[0].id;
    await db.pool.query(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis)
       values ($1, 'Einmal', 'einmal', 99700, 'netto'), ($1, 'Später', 'einmal', 49700, 'netto')`,
      [product],
    );
    const decisions = parseTaxFile({
      entscheidungen: [{ thrivecart_product_id: 904, tax_category: "standard", source: "Thrivecart-Produkt", amount_basis: "brutto" }],
    });
    const r = await tx(db.pool, (c) => confirmTaxCategories(c, decisions, "anna.admin@beispiel.de"));
    assert.deepEqual(r, { confirmed: 1, activated: 1, unknown: [] });
    const bases = (await db.pool.query(`select distinct amount_basis from app.price_options where product_id = $1`, [product])).rows;
    assert.deepEqual(bases, [{ amount_basis: "brutto" }]);
    await assert.rejects(
      tx(db.pool, (c) =>
        confirmTaxCategories(
          c,
          [{ thrivecart_product_id: 902, tax_category: "standard", source: "x", amount_basis: "inklusive" as never }],
          "anna.admin@beispiel.de",
        ),
      ),
      /Unbekannte Preisart/,
    );
  });

  it("verlangt eine aktive Admin-Person und eine gültige Kategorie", async () => {
    await assert.rejects(
      tx(db.pool, (c) => confirmTaxCategories(c, [], "unbekannt@beispiel.de")),
      /Keine aktive Admin-Person/,
    );
    await assert.rejects(
      tx(db.pool, (c) =>
        confirmTaxCategories(c, [{ thrivecart_product_id: 904, tax_category: "frei" as never, source: "x" }], "anna.admin@beispiel.de"),
      ),
      /Unbekannte Steuerkategorie/,
    );
    assert.throws(() => parseTaxFile({}), /entscheidungen/);
  });

  it("setzt den MWST-Satz für die Schweiz", async () => {
    await tx(db.pool, (c) => setSwissVatRate(c, companyId, 810, "cli:test"));
    const row = (await db.pool.query(`select ch_vat_rate_bp from app.companies where id = $1`, [companyId])).rows[0];
    assert.equal(row.ch_vat_rate_bp, 810);
    await assert.rejects(tx(db.pool, (c) => setSwissVatRate(c, companyId, 0, "cli:test")), /Basispunkten/);
  });

  it("stellt den Zahlungsmodus um und steht ohne Angabe auf live", async () => {
    const mode = async () => (await db.pool.query(`select payments_mode from app.companies where id = $1`, [companyId])).rows[0].payments_mode;
    assert.equal(await mode(), "live");
    await tx(db.pool, (c) => setPaymentsMode(c, companyId, "test", "cli:test"));
    assert.equal(await mode(), "test");
    await tx(db.pool, (c) => setPaymentsMode(c, companyId, "live", "cli:test"));
    assert.equal(await mode(), "live");
    await assert.rejects(tx(db.pool, (c) => setPaymentsMode(c, companyId, "probe" as never, "cli:test")), /live oder test/);
  });
});
