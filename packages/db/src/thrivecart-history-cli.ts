import { parseArgs } from "node:util";
import pg from "pg";
import { importHistory, readSource } from "./thrivecart-history.ts";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

const url = process.env.DATABASE_URL;
const sourceUrl = process.env.SOURCE_DATABASE_URL;
if (!url || !sourceUrl) {
  console.error("Aufruf: DATABASE_URL=… SOURCE_DATABASE_URL=… pnpm thrivecart:history [--dry-run]");
  process.exit(1);
}

// Die Quelle wird nur gelesen; die Sitzung ist zusätzlich auf Nur-Lesen gestellt.
const source = new pg.Client({ connectionString: sourceUrl });
await source.connect();
let data;
try {
  await source.query("set session characteristics as transaction read only");
  data = await readSource(source);
} finally {
  await source.end();
}
console.log(
  `Gelesen: ${data.customers.length} Kunden, ${data.purchases.length} Einmalkäufe, ${data.subscriptions.length} Abos/Raten, ${data.events.length} Zahlungsereignisse`,
);

const target = new pg.Client({ connectionString: url });
await target.connect();
try {
  await target.query("begin");
  const stats = await importHistory(target, data);
  const gaps = stats.missingInvoiceNumbers;
  const summary = { ...stats, missingInvoiceNumbers: `${gaps.length} (${gaps.slice(0, 20).join(", ")}${gaps.length > 20 ? ", …" : ""})` };
  if (values["dry-run"]) {
    await target.query("rollback");
    console.log("Probelauf, nichts gespeichert:", summary);
  } else {
    await target.query("commit");
    console.log("Gespeichert:", summary);
  }
} catch (err) {
  await target.query("rollback").catch(() => {});
  throw err;
} finally {
  await target.end();
}
