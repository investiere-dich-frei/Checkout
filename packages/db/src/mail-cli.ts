import pg from "pg";
import { graphConfig, graphSender } from "./graph-mail.ts";
import { sendPendingMails } from "./mail-outbox.ts";

// Verschickt fällige E-Mails aus dem Postausgang. Läuft jede Minute per Timer.
// Gibt nur Zahlen aus, keine Empfänger oder Inhalte.
const url = process.env.DATABASE_URL;
const config = graphConfig();
if (!url || !config) {
  console.error("DATABASE_URL oder GRAPH_*/MAIL_FROM fehlt");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const r = await sendPendingMails(pool, graphSender(config));
  if (r.sent || r.failed) console.log(`Postausgang: ${r.sent} versendet, ${r.failed} fehlgeschlagen`);
  process.exitCode = r.failed ? 1 : 0;
} finally {
  await pool.end();
}
