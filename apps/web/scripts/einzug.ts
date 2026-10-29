import pg from "pg";
import Stripe from "stripe";
import { runCharging } from "../lib/charging";
import { todayBerlin } from "../lib/format";
import { paypal } from "../lib/paypal";

// Täglicher Einzug fälliger Raten und Abo-Zahlungen. Läuft per Timer auf dem App-Server.
// Gibt nur Zahlen aus, keine Kundendaten.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 3 });
try {
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 }) : null;
  const run = await runCharging(pool, { stripe, paypal: paypal() }, todayBerlin());
  console.log("Einzug:", run);
  process.exitCode = run.errors ? 1 : 0;
} finally {
  await pool.end();
}
