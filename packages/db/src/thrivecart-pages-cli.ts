import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { importThrivecartPages } from "./thrivecart-pages.ts";

/**
 * Übernimmt gesicherte Thrivecart-Kaufseiten als Kaufseiten-Gestaltung.
 * Ordner: html/<slug>.html und bilder/<dateiname> (wie von der Sicherung angelegt).
 * Ohne --schreiben ist es ein Probelauf: alles wird geprüft, nichts gespeichert.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    schreiben: { type: "boolean", default: false },
    ueberschreiben: { type: "boolean", default: false },
  },
});

const dir = positionals[0];
const url = process.env.DATABASE_URL;
if (!dir || !url) {
  console.error("Aufruf: DATABASE_URL=… pnpm db:kaufseiten:thrivecart <absoluter Pfad zum Ordner> [--schreiben] [--ueberschreiben]");
  process.exit(1);
}

const pages = [];
for (const f of (await readdir(join(dir, "html"))).filter((f) => f.endsWith(".html")).sort()) {
  pages.push({ slug: f.replace(/\.html$/, ""), html: await readFile(join(dir, "html", f), "utf8") });
}
const images = new Map<string, Uint8Array>();
for (const f of await readdir(join(dir, "bilder"))) {
  if (f.endsWith(".tsv")) continue;
  images.set(f, await readFile(join(dir, "bilder", f)));
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  const rows = await importThrivecartPages(client, pages, images, { overwrite: values.ueberschreiben });
  for (const r of rows) console.log(`${r.status.padEnd(28)} ${r.slug}${r.blocks ? ` (${r.blocks} Bausteine)` : ""}${r.detail ? ` – ${r.detail}` : ""}`);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  console.log(`\n${pages.length} Seiten: ${count("übernommen") + count("überschrieben")} übernommen, ${count("vorhanden, ausgelassen")} schon gestaltet, ${count("Seite fehlt bei Thrivecart")} bei Thrivecart nicht mehr vorhanden, ${count("kein Produkt")} ohne Produkt, ${count("Bild fehlt")} mit fehlendem Bild.`);
  if (values.schreiben) {
    await client.query("commit");
    console.log("Gespeichert.");
  } else {
    await client.query("rollback");
    console.log("Probelauf, nichts gespeichert. Zum Speichern mit --schreiben wiederholen.");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
