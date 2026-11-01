import type { SessionUser } from "@idf/db/auth";
import { completeRefund, failRefund, requestRefund } from "@idf/db/refunds";
import type pg from "pg";
import type Stripe from "stripe";
import type { PaypalApi } from "./paypal";

export type RefundResult = { ok: true; stornoNumber: string; scope: "voll" | "teil"; amountCents: number; currency: string } | { ok: false; message: string };

async function inTx<T>(pool: pg.Pool, actor: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', $1, true)`, [actor]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Rechnung erstatten: anfordern, beim Anbieter auslösen, dann stornieren (voll) oder
 * korrigieren (Teilbetrag). Ohne amountCents wird der ganze noch offene Betrag erstattet.
 * Die Erstattungs-ID dient dem Anbieter als Idempotenzschlüssel; ein Doppelklick
 * erstattet nicht doppelt.
 */
export async function refundInvoice(
  pool: pg.Pool,
  apis: { stripe: Stripe | null; paypal: PaypalApi | null },
  user: SessionUser,
  invoiceId: string,
  reason: string,
  amountCents?: number,
): Promise<RefundResult> {
  const actor = `user:${user.id}`;
  const req = await inTx(pool, actor, (c) => requestRefund(c, user, invoiceId, reason, amountCents));
  let providerRefundId: string;
  try {
    if (req.provider === "stripe") {
      if (!apis.stripe) throw new Error("Stripe ist nicht eingerichtet");
      const r = await apis.stripe.refunds.create(
        { payment_intent: req.paymentRef, amount: req.amountCents, metadata: { refund_id: req.refundId } },
        { idempotencyKey: `erstattung-${req.refundId}` },
      );
      if (r.status === "failed" || r.status === "canceled") throw Object.assign(new Error("abgelehnt"), { code: r.failure_reason ?? r.status });
      providerRefundId = r.id;
    } else if (req.provider === "paypal") {
      if (!apis.paypal) throw new Error("PayPal ist nicht eingerichtet");
      const r = await apis.paypal.refundCapture(
        req.paymentRef,
        `erstattung-${req.refundId}`,
        req.scope === "teil" ? { amountCents: req.amountCents, currency: req.currency } : undefined,
      );
      if (r.status !== "COMPLETED" && r.status !== "PENDING") throw Object.assign(new Error("abgelehnt"), { code: r.status });
      providerRefundId = r.id;
    } else {
      // Überweisung: Rückzahlung von Hand; hier nur die Buchung.
      providerRefundId = `manuell-${req.refundId}`;
    }
  } catch (err) {
    const code = (err as { code?: string; status?: number }).code ?? String((err as { status?: number }).status ?? (err as Error).message);
    await inTx(pool, actor, (c) => failRefund(c, req.refundId, code));
    return { ok: false, message: `Erstattung abgelehnt (${code}). Die Rechnung bleibt unverändert.` };
  }
  const done = await inTx(pool, actor, (c) => completeRefund(c, req.refundId, providerRefundId));
  return { ok: true, stornoNumber: done.stornoNumber, scope: done.scope, amountCents: req.amountCents, currency: req.currency };
}
