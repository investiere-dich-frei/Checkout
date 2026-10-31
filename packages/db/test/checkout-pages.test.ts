import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_CONTENT,
  PageContentError,
  getImage,
  getStoredPage,
  listPageOverview,
  parsePageContent,
  resolvePage,
  saveImage,
  savePage,
  sniffImageType,
} from "../src/checkout-pages.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Kleinstes gültiges PNG (1 × 1 Pixel), ausgedacht.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

describe("Inhalt einer Kaufseite prüfen", () => {
  it("nimmt alle Bausteinarten an und setzt Vorgaben", () => {
    const c = parsePageContent({
      headline: "  Investieren ist Handwerk  ",
      blocks: [
        { type: "ueberschrift", area: "inhalt", text: "Das bekommst du" },
        { type: "liste", area: "inhalt", title: "Leistungen", items: ["Live-Calls", "", "Videokurs"] },
        { type: "zitat", area: "unten", text: "Super", name: "Erika M." },
        { type: "vertrauen", area: "formular", items: ["Sichere Zahlung"] },
      ],
    });
    assert.equal(c.headline, "Investieren ist Handwerk");
    assert.equal(c.accentColor, "#a26766");
    assert.deepEqual((c.blocks[1] as { items: string[] }).items, ["Live-Calls", "Videokurs"]);
    assert.equal((c.blocks[2] as { imageId: string | null }).imageId, null);
  });

  it("lehnt Unbekanntes und zu Langes ab", () => {
    assert.throws(() => parsePageContent({ blocks: [{ type: "html", area: "inhalt", text: "<script>" }] }), PageContentError);
    assert.throws(() => parsePageContent({ blocks: [{ type: "text", area: "kopf", text: "x" }] }), PageContentError);
    assert.throws(() => parsePageContent({ blocks: [], accentColor: "red" }), PageContentError);
    assert.throws(() => parsePageContent({ blocks: [{ type: "text", area: "inhalt", text: "x".repeat(5001) }] }), PageContentError);
    assert.throws(() => parsePageContent({ blocks: [{ type: "bild", area: "inhalt", imageId: "" }] }), PageContentError);
  });

  it("erkennt Bildformate am Inhalt", () => {
    assert.equal(sniffImageType(PNG), "image/png");
    assert.equal(sniffImageType(Buffer.from("<svg></svg>")), null);
  });
});

describe("Kaufseiten speichern", () => {
  let db: TestDb;
  let product: string;
  let admin: string;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('T', 'S', '1', 'B') returning id`);
    admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'A', 'admin') returning id`);
    product = await q(`insert into app.products (company_id, name, slug, tax_category) values ($1, 'Kurs', 'kurs', 'standard') returning id`, [company]);
  });
  after(() => db.drop());

  it("ohne Gestaltung gilt die eingebaute Vorgabe", async () => {
    assert.deepEqual(await resolvePage(db.pool, product), DEFAULT_CONTENT);
    assert.equal(await getStoredPage(db.pool, product), null);
  });

  it("legt Bilder einmal ab und liefert sie aus", async () => {
    const id = await tx(db.pool, (c) => saveImage(c, PNG, "logo.png", admin));
    const again = await tx(db.pool, (c) => saveImage(c, PNG, "nochmal.png", admin));
    assert.equal(again, id);
    const img = await getImage(db.pool, id);
    assert.equal(img?.mimeType, "image/png");
    assert.ok(img?.data.equals(PNG));
    await assert.rejects(tx(db.pool, (c) => saveImage(c, Buffer.from("kein bild"), "x.png", admin)), PageContentError);
    await assert.rejects(db.pool.query(`update app.checkout_images set original_name = 'x' where id = $1`, [id]), /nicht geändert/);
  });

  it("Standardseite liefert Logo und Inhalt für Produkte ohne eigene Seite", async () => {
    const logo = await tx(db.pool, (c) => saveImage(c, PNG, "logo.png", admin));
    await tx(db.pool, (c) => savePage(c, null, { headline: "", logoImageId: logo, ctaText: "Los", blocks: [] }, admin));
    const p = await resolvePage(db.pool, product);
    assert.equal(p.logoImageId, logo);
    assert.equal(p.ctaText, "Los");

    await tx(db.pool, (c) => savePage(c, product, { headline: "Eigene", blocks: [{ type: "text", area: "inhalt", text: "Hallo" }] }, admin));
    const own = await resolvePage(db.pool, product);
    assert.equal(own.headline, "Eigene");
    assert.equal(own.logoImageId, logo, "Logo kommt von der Standardseite");

    // Zweites Speichern ändert dieselbe Zeile.
    await tx(db.pool, (c) => savePage(c, product, { headline: "Neu", blocks: [] }, admin));
    const { rows } = await db.pool.query(`select count(*)::int n from app.checkout_pages`);
    assert.equal(rows[0].n, 2);
    assert.equal((await resolvePage(db.pool, product)).headline, "Neu");

    const overview = await listPageOverview(db.pool);
    assert.equal(overview.find((r) => r.productId === product)?.hasOwnPage, true);
  });

  it("speichert keine Seite mit fehlendem Bild und schreibt ins Audit-Log", async () => {
    await assert.rejects(
      tx(db.pool, (c) =>
        savePage(c, product, { blocks: [{ type: "bild", area: "inhalt", imageId: "00000000-0000-4000-8000-000000000000", alt: "" }] }, admin),
      ),
      PageContentError,
    );
    const { rows } = await db.pool.query(`select count(*)::int n from app.audit_log where table_name = 'checkout_pages'`);
    assert.ok(rows[0].n >= 3);
  });
});
