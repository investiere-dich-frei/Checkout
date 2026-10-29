import pg from "pg";
import { deliverWebhooks } from "./webhooks.ts";

// Stellt ausgehende Webhooks zu. Läuft jede Minute per Timer. Gibt nur Zahlen aus.
const url = process.env.DATABASE_URL;
const target = process.env.OUTBOUND_WEBHOOK_URL;
const secret = process.env.OUTBOUND_WEBHOOK_SECRET;
if (!url || !target || !secret) {
  console.error("DATABASE_URL, OUTBOUND_WEBHOOK_URL oder OUTBOUND_WEBHOOK_SECRET fehlt");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const r = await deliverWebhooks(pool, { url: target, secret });
  if (r.delivered || r.failed) console.log(`Webhooks: ${r.delivered} zugestellt, ${r.failed} fehlgeschlagen`);
  process.exitCode = r.failed ? 1 : 0;
} finally {
  await pool.end();
}
