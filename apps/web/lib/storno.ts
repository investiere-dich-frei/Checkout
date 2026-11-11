import type { SessionUser } from "@idf/db/auth";
import { RefundError, stornoOrder, type StornoKind } from "@idf/db/refunds";
import { takeoverOfOrder } from "@idf/db/takeover";
import type pg from "pg";
import type Stripe from "stripe";
import type { PaypalApi } from "./paypal";
import { inTx, refundInvoice } from "./refund";

export interface StornoRequest {
  orderId: string;
  kind: StornoKind;
  reason: string;
  today: string;
  /** Nur Abo ohne Rückzahlung: letzter Tag der Laufzeit; leer = sofort. */
  endsOn?: string | null;
  /** Nur mit Rückzahlung: Rechnungen, deren noch offener Betrag voll erstattet wird. */
  invoiceIds?: string[];
}

export interface StornoResult {
  ok: boolean;
  /** Zeilen für die Rückmeldung in der Verwaltung. */
  lines: string[];
}

/**
 * Storno aus der Verwaltung. Zuerst endet die Bestellung (damit nichts mehr abgebucht wird),
 * bei aus Thrivecart übernommenen PayPal-Abos wird das Abo bei PayPal gekündigt, danach werden
 * bei „mit Rückzahlung“ die gewählten Rechnungen einzeln erstattet. Scheitert eine Erstattung,
 * bleibt die Bestellung beendet; die Erstattung lässt sich unter „Rechnungen“ erneut auslösen.
 */
export async function performStorno(
  pool: pg.Pool,
  apis: { stripe: Stripe | null; paypal: PaypalApi | null },
  user: SessionUser,
  req: StornoRequest,
): Promise<StornoResult> {
  const actor = `user:${user.id}`;
  const invoiceIds = [...new Set(req.invoiceIds ?? [])];
  if (req.kind === "mit_rueckzahlung") {
    if (invoiceIds.length === 0) throw new RefundError("Bitte mindestens eine Rechnung zum Erstatten auswählen");
    const { rows } = await pool.query<{ id: string }>(
      `select id from app.invoices where id = any($1::uuid[]) and order_id = $2 and kind = 'rechnung'`,
      [invoiceIds, req.orderId],
    );
    if (rows.length !== invoiceIds.length) throw new RefundError("Eine gewählte Rechnung gehört nicht zu dieser Bestellung");
  } else if (invoiceIds.length > 0) {
    throw new RefundError("Ohne Rückzahlung wird nichts erstattet");
  }

  const record = await inTx(pool, actor, (c) => stornoOrder(c, user, req));
  const lines: string[] = [];
  let ok = true;
  lines.push(
    record.effectiveOn > req.today
      ? `Abo endet am ${record.effectiveOn.split("-").reverse().join(".")}. Bis dahin wird weiter abgebucht, danach nichts mehr.`
      : "Bestellung ist beendet: Offene Raten entfallen, es wird nichts mehr abgebucht.",
  );

  const takeover = await takeoverOfOrder(pool, req.orderId);
  if (takeover?.route === "paypal" && record.effectiveOn <= req.today) {
    try {
      if (!apis.paypal) throw new Error("PayPal ist nicht eingerichtet");
      await apis.paypal.cancelSubscription(takeover.remote_subscription_id, req.reason);
      lines.push(`PayPal-Abo ${takeover.remote_subscription_id} ist bei PayPal gekündigt.`);
    } catch (err) {
      ok = false;
      console.error("PayPal-Abo nicht gekündigt", (err as Error).message);
      lines.push(`Achtung: PayPal-Abo ${takeover.remote_subscription_id} konnte nicht gekündigt werden. Bitte in PayPal von Hand kündigen, sonst bucht PayPal weiter ab.`);
    }
  }

  for (const invoiceId of invoiceIds) {
    try {
      const r = await refundInvoice(pool, apis, user, invoiceId, req.reason);
      if (r.ok) {
        lines.push(
          r.scope === "voll"
            ? `Erstattet, Stornorechnung ${r.stornoNumber} geht per E-Mail an die Kundin.`
            : `Rest erstattet, Rechnungskorrektur ${r.stornoNumber} geht per E-Mail an die Kundin.`,
        );
      } else {
        ok = false;
        lines.push(`${r.message} Bitte unter „Rechnungen“ erneut erstatten.`);
      }
    } catch (err) {
      ok = false;
      const msg = err instanceof RefundError ? err.message : "Erstattung nicht möglich";
      if (!(err instanceof RefundError)) console.error("Erstattung beim Storno fehlgeschlagen", (err as Error).message);
      lines.push(`${msg}. Bitte unter „Rechnungen“ erneut erstatten.`);
    }
  }
  return { ok, lines };
}
