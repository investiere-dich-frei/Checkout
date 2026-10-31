import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { confirmTaxCategories, parseTaxFile, parseUsers, setPaymentsMode, setSwissVatRate, upsertUsers } from "./setup.ts";

const USAGE = `Aufruf:
  DATABASE_URL=… pnpm db:configure users <zugaenge.json> --actor cli:<name> [--dry-run]
  DATABASE_URL=… pnpm db:configure tax <steuer-je-produkt.json> --by <admin-e-mail> [--dry-run]
  DATABASE_URL=… pnpm db:configure ch-vat <basispunkte> --company <id> --actor cli:<name> [--dry-run]
  DATABASE_URL=… pnpm db:configure payments-mode <live|test> --company <id> --actor cli:<name> [--dry-run]`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    actor: { type: "string" },
    by: { type: "string" },
    company: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const [command, arg] = positionals;
const url = process.env.DATABASE_URL;
if (!command || !arg || !url) {
  console.error(USAGE);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  let summary: string;
  if (command === "users" && values.actor) {
    const n = await upsertUsers(client, parseUsers(JSON.parse(await readFile(arg, "utf8"))), values.actor);
    summary = `${n} Zugänge angelegt oder aktualisiert`;
  } else if (command === "tax" && values.by) {
    const r = await confirmTaxCategories(client, parseTaxFile(JSON.parse(await readFile(arg, "utf8"))), values.by);
    summary = `${r.confirmed} Produkte bestätigt, davon ${r.activated} freigeschaltet`;
    if (r.unknown.length) summary += `; nicht im Katalog: ${r.unknown.join(", ")}`;
  } else if (command === "ch-vat" && values.company && values.actor) {
    await setSwissVatRate(client, values.company, Number(arg), values.actor);
    summary = `MWST Schweiz auf ${(Number(arg) / 100).toFixed(2)} % gesetzt`;
  } else if (command === "payments-mode" && values.company && values.actor) {
    if (arg === "test" && !/test/i.test(new URL(url).pathname)) {
      throw new Error("Testbetrieb nur in einer Datenbank, deren Name „test“ enthält (z. B. idf_test)");
    }
    await setPaymentsMode(client, values.company, arg as "live" | "test", values.actor);
    summary = `Zahlungsmodus auf ${arg} gesetzt`;
  } else {
    console.error(USAGE);
    process.exitCode = 1;
    await client.query("rollback");
    process.exit();
  }
  if (values["dry-run"]) {
    await client.query("rollback");
    console.log(`Probelauf, nichts gespeichert. ${summary}.`);
  } else {
    await client.query("commit");
    console.log(`${summary}.`);
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
