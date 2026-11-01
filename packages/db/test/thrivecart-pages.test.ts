import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { getStoredPage, resolvePage } from "../src/checkout-pages.ts";
import { parsePageContent } from "../src/checkout-page-content.ts";
import { imageKey, importThrivecartPages, isMissingPage, parseThrivecartPage } from "../src/thrivecart-pages.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("Thrivecart-Kaufseiten lesen", () => {
  it("übernimmt Kopfbereich, Bausteine und Bereiche der neuen Vorlage", () => {
    const d = parseThrivecartPage(fixture("thrivecart-v2.html"));
    assert.equal(d.template, "v2");
    assert.equal(d.headline, "Lernen ist ein Handwerk.");
    assert.equal(d.subheadline, "Ein Beispielkurs. In 6 Wochen & mit Begleitung.");
    assert.equal(d.ctaText, "Jetzt anmelden");
    assert.equal(d.logoImage, "logo-123.png");
    assert.equal(d.heroImage, "kurs-1.webp");
    assert.deepEqual(
      d.blocks.map((b) => `${b.area}:${b.type}`),
      ["mitte:bild", "mitte:ueberschrift", "mitte:liste", "inhalt:ueberschrift", "inhalt:text", "inhalt:vertrauen", "unten:person"],
    );
    const liste = d.blocks[2] as { items: string[] };
    assert.deepEqual(liste.items, ["**6 Wochen Live-Calls** mit Beispiel & Gästen", "**Workbook** als PDF"]);
    assert.equal((d.blocks[4] as { text: string }).text, "Erster Absatz.\n\nZweiter Absatz.");
    assert.deepEqual((d.blocks[5] as { items: string[] }).items, ["Daten geschützt", "Sichere Zahlung"]);
    const person = d.blocks[6] as { title: string; text: string; imageId: string };
    assert.equal(person.title, '"Ein Beispielzitat"');
    assert.equal(person.text, "Ich bin Beispiel.\n\nZweiter Teil.\nDritter Teil.");
    assert.equal(person.imageId, "person-1.webp");
    assert.deepEqual(d.images.sort(), ["bundle-1.png", "kurs-1.webp", "logo-123.png", "person-1.webp"]);
    // Formular, Gutscheinhinweis, Fußzeile und Platzhalter fehlen.
    const all = JSON.stringify(d);
    for (const t of ["Ihr Name", "BEISPIEL", "ThriveCart", "Enter your bullet", "Trag unten"]) assert.ok(!all.includes(t), t);
  });

  it("liest die ältere Vorlage und wandelt Emojis", () => {
    const d = parseThrivecartPage(fixture("thrivecart-alt.html"));
    assert.equal(d.template, "alt");
    assert.deepEqual(d.blocks.map((b) => b.type), ["bild", "text", "text"]);
    assert.equal((d.blocks[1] as { text: string }).text, "**Mini-Kurs**\n\n**Beispiel**");
    assert.equal((d.blocks[2] as { text: string }).text, "**🧭Klarheit in 2 Stunden.**\n\n+ Punkt eins\n+ Punkt zwei");
    assert.deepEqual(d.images, ["bild-alt.png"]);
  });

  it("ergibt mit Bild-IDs einen gültigen Seiteninhalt", () => {
    const d = parseThrivecartPage(fixture("thrivecart-v2.html"));
    const id = "00000000-0000-4000-8000-000000000001";
    const blocks = d.blocks.map((b) => ("imageId" in b && b.imageId ? { ...b, imageId: id } : b));
    assert.doesNotThrow(() => parsePageContent({ ...d, logoImageId: id, heroImageId: id, accentColor: "", blocks }));
  });

  it("erkennt IDF-Bilder und fehlende Seiten", () => {
    assert.equal(imageKey("https://spark.thrivecart.com/0x0/user_assets%2FLGUM1CR8%2Fuploads%2Fimages%2Fa-1.png?x=1"), "a-1.png");
    assert.equal(imageKey("https://tinder.thrivecart.com/x/cards_full.png"), null);
    assert.equal(imageKey("https://spark.thrivecart.com/0x0/user_assets%2FLGUM1CR8%2Fuploads%2Fimages%2F..%2Fx"), null);
    assert.equal(isMissingPage("<html><head><title>ThriveCart</title></head><body></body></html>"), true);
  });
});

describe("Thrivecart-Kaufseiten übernehmen", () => {
  // Kleinstes gültiges PNG, ausgedacht.
  const PNG = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  );
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const company = await q(`insert into app.companies (legal_name, street, postal_code, city) values ('T', 'S', '1', 'B') returning id`);
    for (const slug of ["kurs-neu", "kurs-alt", "kurs-bild-fehlt"]) {
      await db.pool.query(`insert into app.products (company_id, name, slug, tax_category) values ($1, $2, $2, 'standard')`, [company, slug]);
    }
  });
  after(() => db.drop());

  it("legt Seiten und Standardlogo an, lässt Fehlendes aus und überschreibt nichts", async () => {
    const v2 = fixture("thrivecart-v2.html");
    const pages = [
      { slug: "kurs-neu", html: v2 },
      { slug: "kurs-alt", html: fixture("thrivecart-alt.html") },
      { slug: "kurs-bild-fehlt", html: v2.replace("kurs-1.webp", "gibt-es-nicht.webp") },
      { slug: "unbekannt", html: v2 },
      { slug: "weg", html: "<html><title>ThriveCart</title></html>" },
    ];
    const files = new Map(["logo-123.png", "kurs-1.webp", "bundle-1.png", "person-1.webp", "bild-alt.png"].map((f, i) => [f, Buffer.concat([PNG, Buffer.from([i])])]));
    const rows = await tx(db.pool, (c) => importThrivecartPages(c, pages, files));
    assert.deepEqual(
      rows.map((r) => `${r.slug}:${r.status}`),
      ["kurs-neu:übernommen", "kurs-alt:übernommen", "kurs-bild-fehlt:Bild fehlt", "unbekannt:kein Produkt", "weg:Seite fehlt bei Thrivecart"],
    );
    const product = (await db.pool.query(`select id from app.products where slug = 'kurs-neu'`)).rows[0].id;
    const page = await resolvePage(db.pool, product);
    assert.equal(page.headline, "Lernen ist ein Handwerk.");
    assert.equal(page.blocks.length, 7);
    const standard = await getStoredPage(db.pool, null);
    assert.ok(standard?.content.logoImageId);
    const { rows: n } = await db.pool.query(`select count(*)::int n from app.checkout_images`);
    assert.equal(n[0].n, 5, "jedes Bild einmal");

    const again = await tx(db.pool, (c) => importThrivecartPages(c, pages.slice(0, 1), files));
    assert.equal(again[0]!.status, "vorhanden, ausgelassen");
    const forced = await tx(db.pool, (c) => importThrivecartPages(c, pages.slice(0, 1), files, { overwrite: true }));
    assert.equal(forced[0]!.status, "überschrieben");

    // Im Editor bearbeitete Seiten bleiben auch mit „überschreiben“ unangetastet.
    const admin = (await db.pool.query(`insert into app.users (email, display_name, role) values ('a@example.org', 'A', 'admin') returning id`)).rows[0].id;
    await db.pool.query(`update app.checkout_pages set updated_by = $1 where product_id = $2`, [admin, product]);
    const kept = await tx(db.pool, (c) => importThrivecartPages(c, pages.slice(0, 1), files, { overwrite: true }));
    assert.equal(kept[0]!.status, "von Hand bearbeitet, ausgelassen");
  });
});
