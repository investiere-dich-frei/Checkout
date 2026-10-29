import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { importCatalog, parseCatalog } from "./thrivecart-import.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    company: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const file = positionals[0];
const url = process.env.DATABASE_URL;
if (!file || !values.company || !url) {
  console.error("Aufruf: DATABASE_URL=… pnpm thrivecart:import <katalog.json> --company <uuid> [--dry-run]");
  process.exit(1);
}

const catalog = parseCatalog(JSON.parse(await readFile(file, "utf8")));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  const stats = await importCatalog(client, catalog, values.company);
  if (values["dry-run"]) {
    await client.query("rollback");
    console.log("Probelauf, nichts gespeichert:", stats);
  } else {
    await client.query("commit");
    console.log("Gespeichert:", stats);
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
