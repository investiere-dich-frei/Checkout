import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { currentLegalTexts, findSeller, getOffer } from "../src/catalog.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

// Ausgedachte Daten, keine echten.
describe("Katalog für den Checkout", () => {
  let db: TestDb;
  let option: string;
  let hidden: string;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('T', 'S', '1', 'B') returning id`);
    const admin = await q(`insert into app.users (email, display_name, role, sales_code) values ('a@example.org', 'A', 'admin', 'anna') returning id`);
    await db.pool.query(`insert into app.users (email, display_name, role, sales_code, active) values ('x@example.org', 'X', 'vertrieb', 'alt', false)`);
    const live = await q(
      `insert into app.products (company_id, name, slug, tax_category, active, tax_confirmed_at, tax_confirmed_by)
       values ($1, 'Kurs', 'kurs', 'standard', true, now(), $2) returning id`,
      [company, admin],
    );
    const draft = await q(`insert into app.products (company_id, name, slug, tax_category) values ($1, 'Entwurf', 'entwurf', 'standard') returning id`, [company]);
    option = await q(`insert into app.price_options (product_id, label, kind, amount_cents) values ($1, 'Einmal', 'einmal', 1000) returning id`, [live]);
    hidden = await q(`insert into app.price_options (product_id, label, kind, amount_cents) values ($1, 'Einmal', 'einmal', 1000) returning id`, [draft]);
    for (const [kind, version, from] of [["agb", "1", "2026-01-01"], ["agb", "2", "2026-06-01"], ["agb", "3", "2099-01-01"], ["widerruf", "1", "2026-01-01"]]) {
      await db.pool.query(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, $2, 'Text', $3)`, [kind, version, from]);
    }
  });
  after(() => db.drop());

  it("zeigt nur verkaufbare Angebote, passend zum Produkt", async () => {
    const offer = await getOffer(db.pool, "kurs", option);
    assert.equal(offer?.productName, "Kurs");
    assert.equal(offer?.plan.amountCents, 1000);
    assert.equal(await getOffer(db.pool, "entwurf", hidden), null);
    assert.equal(await getOffer(db.pool, "entwurf", option), null);
  });

  it("nimmt die jeweils gültige Fassung der Rechtstexte", async () => {
    const t = await currentLegalTexts(db.pool);
    assert.equal(t.agb?.version, "2");
    assert.equal(t.widerruf?.version, "1");
    assert.equal(t.datenschutz, null);
  });

  it("findet nur aktive Vertriebspersonen", async () => {
    assert.ok(await findSeller(db.pool, "ANNA"));
    assert.equal(await findSeller(db.pool, "alt"), null);
    assert.equal(await findSeller(db.pool, "gibtsnicht"), null);
  });
});
