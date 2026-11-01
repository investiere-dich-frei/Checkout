import pg from "pg";
import Stripe from "stripe";
import { runCharging } from "../lib/charging";
import { runDunning } from "../lib/dunning";
import { todayBerlin } from "../lib/format";
import { isPaypalLive, paypal } from "../lib/paypal";
import { assertTestDatabase, parseStichtag } from "../lib/stichtag";
import { syncPaypalAbos } from "../lib/takeover";

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
  // Übernommene PayPal-Abos bucht PayPal selbst ab; hier werden ihre Zahlungen verbucht.
  const api = paypal();
  const abo = api ? await syncPaypalAbos(pool, api, stichtag ?? todayBerlin(), isPaypalLive()) : null;
  if (abo) console.log("PayPal-Abos:", abo);
  // Mahnwesen nach dem Einzug, damit Ablehnungen von heute gleich gemeldet werden.
  const base = process.env.PUBLIC_BASE_URL;
  let dunningErrors = 0;
  if (base) {
    const dunning = await runDunning(pool, stripe, stichtag ?? todayBerlin(), base);
    console.log("Mahnwesen:", dunning);
    dunningErrors = dunning.errors;
  } else {
    console.error("PUBLIC_BASE_URL fehlt: Mahnwesen übersprungen (Links zum Kundenbereich brauchen die Adresse).");
    dunningErrors = 1;
  }
  process.exitCode = run.errors || abo?.errors || dunningErrors ? 1 : 0;
} finally {
  await pool.end();
}
