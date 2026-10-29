import type pg from "pg";
import { invoicePdf } from "./invoice-pdf.ts";

/**
 * Postausgang: E-Mails werden in der Datenbank angelegt und von einem eigenen Lauf
 * verschickt. So geht keine Bestätigung verloren, wenn der Mailversand kurz ausfällt.
 */

export interface OutgoingMail {
  id: string;
  to: string;
  subject: string;
  body: string;
  attachments: { name: string; contentType: string; content: Buffer }[];
}

export type SendMail = (mail: OutgoingMail) => Promise<{ messageId: string | null }>;

/** Wartezeit bis zum nächsten Versuch: 1, 2, 4 … Minuten, höchstens eine Stunde. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/**
 * Fällige E-Mails verschicken. Jede E-Mail wird in einer eigenen Transaktion gesperrt,
 * verschickt und als versendet markiert; parallele Läufe überspringen gesperrte Zeilen.
 * Gibt die Zahl der versendeten und fehlgeschlagenen E-Mails zurück, keine Inhalte.
 */
export async function sendPendingMails(pool: pg.Pool, send: SendMail, limit = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.actor', 'system:postausgang', true)`);
      const { rows } = await c.query<{
        id: string;
        purpose: string;
        related_id: string | null;
        to_address: string;
        subject: string;
        body_text: string;
        attempts: number;
      }>(
        `select id, purpose, related_id, to_address, subject, body_text, attempts from app.mail_outbox
          where sent_at is null and next_attempt_at <= now()
          order by next_attempt_at limit 1 for update skip locked`,
      );
      const m = rows[0];
      if (!m) {
        await c.query("commit");
        break;
      }
      try {
        const attachments: OutgoingMail["attachments"] = [];
        if (m.purpose === "rechnung" && m.related_id) {
          // Ohne PDF keine Rechnungsmail: lieber später erneut versuchen.
          const doc = await invoicePdf(c, m.related_id);
          if (!doc) throw new Error("Rechnungs-PDF fehlt");
          attachments.push({ name: doc.filename, contentType: "application/pdf", content: doc.pdf });
        }
        const r = await send({ id: m.id, to: m.to_address, subject: m.subject, body: m.body_text, attachments });
        await c.query(`update app.mail_outbox set sent_at = now(), attempts = attempts + 1, last_error = null, provider_message_id = $2 where id = $1`, [
          m.id,
          r.messageId,
        ]);
        sent++;
      } catch (err) {
        await c.query(
          `update app.mail_outbox set attempts = attempts + 1, last_error = $2, next_attempt_at = now() + $3 * interval '1 millisecond' where id = $1`,
          [m.id, String((err as Error).message).slice(0, 500), retryDelayMs(m.attempts + 1)],
        );
        failed++;
      }
      await c.query("commit");
    } catch (err) {
      await c.query("rollback").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
  return { sent, failed };
}
