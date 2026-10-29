import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { createCompany, parseCompany } from "./company.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    actor: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const file = positionals[0];
const url = process.env.DATABASE_URL;
if (!file || !values.actor || !url) {
  console.error("Aufruf: DATABASE_URL=… pnpm company:create <gesellschaft.json> --actor cli:<name> [--dry-run]");
  process.exit(1);
}

const input = parseCompany(JSON.parse(await readFile(file, "utf8")));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  const id = await createCompany(client, input, values.actor);
  if (values["dry-run"]) {
    await client.query("rollback");
    console.log(`Probelauf, nichts gespeichert. Gesellschaft hätte die ID ${id} bekommen.`);
  } else {
    await client.query("commit");
    console.log(`Angelegt: ${input.legal_name}, ID ${id}, erste Rechnungsnummer ${input.invoice_prefix}${input.invoice_next_value}`);
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
