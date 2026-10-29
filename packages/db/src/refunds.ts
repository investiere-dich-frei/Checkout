import type pg from "pg";
import type { SessionUser } from "./auth.ts";
import { enqueueInvoiceMail } from "./customer-mails.ts";
import { storeInvoicePdf } from "./invoice-pdf.ts";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Erstattung einer bezahlten Rechnung: anfordern, beim Anbieter auslösen, dann
 * Stornorechnung und Erstattungsbuchung. Der Anbieteraufruf liegt in der Web-App.
 */

export class RefundError extends Error {}

export interface RequestedRefund {
  refundId: string;
  provider: "stripe" | "paypal" | "ueberweisung";
  /** PaymentIntent-ID (Stripe) oder Capture-ID (PayPal) der ursprünglichen Zahlung. */
  paymentRef: string;
  amountCents: number;
  currency: string;
}

export async function requestRefund(client: pg.ClientBase, user: SessionUser, invoiceId: string, reason: string): Promise<RequestedRefund> {
  if (user.role !== "admin") throw new RefundError("Keine Berechtigung");
  if (!reason.trim()) throw new RefundError("Grund fehlt");
  const { rows } = await client.query<{ kind: string; gross_cents: string; currency: string; payment_id: string | null; provider: string; provider_ref: string; storno: boolean }>(
    `select i.kind, i.gross_cents, i.currency, p.id payment_id, p.provider, p.provider_ref,
            exists (select 1 from app.invoices s where s.corrects_invoice_id = i.id and s.kind = 'storno') storno
       from app.invoices i
       left join app.order_installments x on x.invoice_id = i.id
       left join app.payments p on p.id = x.payment_id
      where i.id = $1
      for update of i`,
    [invoiceId],
  );
  const r = rows[0];
  if (!r) throw new RefundError("Rechnung gibt es nicht");
  if (r.kind !== "rechnung") throw new RefundError("Nur Rechnungen können erstattet werden");
  if (r.storno) throw new RefundError("Rechnung ist bereits storniert");
  if (!r.payment_id) throw new RefundError("Zu dieser Rechnung gibt es keine Zahlung");
  if (!["stripe", "paypal", "ueberweisung"].includes(r.provider)) throw new RefundError(`Erstattung über ${r.provider} nicht möglich`);
  const ins = await client.query<{ id: string }>(
    `insert into app.refunds (invoice_id, payment_id, provider, amount_cents, currency, reason, requested_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [invoiceId, r.payment_id, r.provider, r.gross_cents, r.currency, reason.trim(), user.id],
  );
  return {
    refundId: ins.rows[0]!.id,
    provider: r.provider as RequestedRefund["provider"],
    paymentRef: r.provider_ref,
    amountCents: Number(r.gross_cents),
    currency: r.currency,
  };
}

export async function failRefund(client: pg.ClientBase, refundId: string, errorCode: string) {
  await client.query(`update app.refunds set status = 'fehlgeschlagen', error_code = $2 where id = $1 and status = 'angefordert'`, [
    refundId,
    errorCode.slice(0, 200),
  ]);
}

/**
 * Bestätigte Erstattung verbuchen: Stornorechnung über den vollen Betrag mit
 * umgekehrten Positionen, PDF, E-Mail, Erstattungsbuchung und Statusfortschreibung.
 */
export async function completeRefund(client: pg.ClientBase, refundId: string, providerRefundId: string): Promise<{ stornoInvoiceId: string; stornoNumber: string }> {
  const ref = (
    await client.query<{ invoice_id: string; payment_id: string; provider: string; amount_cents: string; currency: string; status: string; storno_invoice_id: string | null }>(
      `select invoice_id, payment_id, provider, amount_cents, currency, status, storno_invoice_id from app.refunds where id = $1 for update`,
      [refundId],
    )
  ).rows[0];
  if (!ref) throw new RefundError("Erstattung gibt es nicht");
  if (ref.status === "erstattet") {
    const n = await client.query<{ invoice_number: string }>(`select invoice_number from app.invoices where id = $1`, [ref.storno_invoice_id]);
    return { stornoInvoiceId: ref.storno_invoice_id!, stornoNumber: n.rows[0]!.invoice_number };
  }
  if (ref.status !== "angefordert") throw new RefundError(`Erstattung hat den Status ${ref.status}`);

  const storno = await client.query<{ id: string; invoice_number: string; order_id: string }>(
    `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
       customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
     select company_id, 0, '', 'storno', id, order_id, customer_id, customer_snapshot, company_snapshot,
            (now() at time zone 'Europe/Berlin')::date, service_date_from, service_date_to, currency,
            -net_cents, -tax_cents, -gross_cents, 'Storno zu Rechnung ' || invoice_number || '. Der Betrag wird erstattet.'
       from app.invoices where id = $1
     returning id, invoice_number, order_id`,
    [ref.invoice_id],
  );
  const s = storno.rows[0]!;
  await client.query(
    `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
     select $1, position, description, -quantity, unit_net_cents, -net_cents, tax_rate_bp, -tax_cents, -gross_cents, tax_exemption_note
       from app.invoice_items where invoice_id = $2 order by position`,
    [s.id, ref.invoice_id],
  );
  await client.query(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, $2, $3, 'erstattet', $4, $5, now())`,
    [s.order_id, ref.provider, providerRefundId, ref.currency, -Number(ref.amount_cents)],
  );
  await client.query(
    `update app.refunds set status = 'erstattet', provider_refund_id = $2, storno_invoice_id = $3, completed_at = now() where id = $1`,
    [refundId, providerRefundId, s.id],
  );
  await client.query(`update app.order_installments set status = 'storniert' where invoice_id = $1`, [ref.invoice_id]);
  // Ist nichts Bezahltes mehr übrig, ist die Bestellung erstattet.
  await client.query(
    `update app.orders o set status = 'erstattet'
      where o.id = $1 and not exists (select 1 from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt')`,
    [s.order_id],
  );
  await storeInvoicePdf(client, s.id);
  await enqueueInvoiceMail(client, s.id);
  await enqueueWebhook(client, "zahlung.erstattet", s.order_id, {
    refund: { provider: ref.provider, gross_cents: Number(ref.amount_cents), storno_number: s.invoice_number },
  });
  return { stornoInvoiceId: s.id, stornoNumber: s.invoice_number };
}

/** Bestellung beenden: offene Raten entfallen, Abo endet heute. Bereits Bezahltes bleibt (Erstattung separat). */
export async function cancelOrder(client: pg.ClientBase, user: SessionUser, orderId: string): Promise<void> {
  if (user.role !== "admin") throw new RefundError("Keine Berechtigung");
  await enqueueWebhook(client, "bestellung.beendet", orderId, { ended_by: `user:${user.id}` });
  await client.query(`update app.order_installments set status = 'storniert' where order_id = $1 and status in ('offen', 'fehlgeschlagen')`, [orderId]);
  await client.query(
    `update app.subscription_terms set ends_on = (now() at time zone 'Europe/Berlin')::date, ended_by = $2 where order_id = $1 and ends_on is null`,
    [orderId, `user:${user.id}`],
  );
  await client.query(
    `update app.orders o set status = case when exists (select 1 from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt')
                                          then o.status else 'storniert' end
      where o.id = $1`,
    [orderId],
  );
}
