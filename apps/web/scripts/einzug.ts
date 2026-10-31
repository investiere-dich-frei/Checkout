import pg from "pg";
import Stripe from "stripe";
import { runCharging } from "../lib/charging";
import { todayBerlin } from "../lib/format";
import { paypal } from "../lib/paypal";
import { assertTestDatabase, parseStichtag } from "../lib/stichtag";

// Täglicher Einzug fälliger Raten und Abo-Zahlungen. Läuft per Timer auf dem App-Server.
// Gibt nur Zahlen aus, keine Kundendaten.
// Nur zum Testen: `--stichtag JJJJ-MM-TT` zieht so ein, als wäre dieser Tag. Das ist nur in
// einer Testdatenbank (Name enthält „test“, alle Gesellschaften payments_mode = 'test') erlaubt.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt");
  process.exit(2);
}
let stichtag: string | null;
try {
  stichtag = parseStichtag(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 3 });
try {
  if (stichtag) {
    await assertTestDatabase(pool).catch((e: Error) => {
      console.error(e.message);
      process.exit(2);
    });
    console.log(`Stichtag ${stichtag} (Testdatenbank). Abos werden ebenfalls bis zu diesem Tag verlängert.`);
  }
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 }) : null;
  const run = await runCharging(pool, { stripe, paypal: paypal() }, stichtag ?? todayBerlin());
  console.log("Einzug:", run);
  process.exitCode = run.errors ? 1 : 0;
} finally {
  await pool.end();
}
