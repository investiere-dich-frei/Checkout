import type pg from "pg";
import type { SessionUser } from "./auth.ts";
import { enqueueInvoiceMail } from "./customer-mails.ts";
import { storeInvoicePdf } from "./invoice-pdf.ts";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Erstattung einer bezahlten Rechnung: anfordern, beim Anbieter auslösen, dann
 * Stornorechnung (voll) oder Rechnungskorrektur (Teil) und Erstattungsbuchung.
 * Der Anbieteraufruf liegt in der Web-App.
 */

export class RefundError extends Error {}

export interface RequestedRefund {
  refundId: string;
  provider: "stripe" | "paypal" | "ueberweisung";
  /** PaymentIntent-ID (Stripe) oder Capture-ID (PayPal) der ursprünglichen Zahlung. */
  paymentRef: string;
  amountCents: number;
  currency: string;
  /** voll = Stornorechnung über alles, teil = Rechnungskorrektur über einen Teil. */
  scope: "voll" | "teil";
}

/** Noch erstattbarer Betrag einer Rechnung (Rechnungsbetrag abzüglich laufender und erfolgter Erstattungen). */
export async function refundableCents(db: pg.ClientBase | pg.Pool, invoiceId: string): Promise<number> {
  const { rows } = await db.query<{ left: string }>(
    `select i.gross_cents - coalesce((select sum(r.amount_cents) from app.refunds r where r.invoice_id = i.id and r.status <> 'fehlgeschlagen'), 0) "left"
       from app.invoices i where i.id = $1`,
    [invoiceId],
  );
  return rows[0] ? Number(rows[0].left) : 0;
}

/**
 * Erstattung anfordern. Ohne amountCents wird der ganze noch offene Betrag erstattet. Ist noch
 * nichts erstattet und geht es um den ganzen Betrag, wird storniert, sonst korrigiert.
 */
export async function requestRefund(
  client: pg.ClientBase,
  user: SessionUser,
  invoiceId: string,
  reason: string,
  amountCents?: number,
): Promise<RequestedRefund> {
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
  const open = await client.query(`select 1 from app.refunds where invoice_id = $1 and status = 'angefordert'`, [invoiceId]);
  if (open.rowCount) throw new RefundError("Zu dieser Rechnung läuft schon eine Erstattung");
  const gross = Number(r.gross_cents);
  const left = await refundableCents(client, invoiceId);
  if (left <= 0) throw new RefundError("Rechnung ist bereits voll erstattet");
  const amount = amountCents ?? left;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RefundError("Bitte einen Betrag über 0 angeben");
  if (amount > left) throw new RefundError(`Höchstens ${(left / 100).toFixed(2).replace(".", ",")} ${r.currency} sind noch erstattbar`);
  const scope = amount === gross && left === gross ? "voll" : "teil";
  const ins = await client.query<{ id: string }>(
    `insert into app.refunds (invoice_id, payment_id, provider, amount_cents, currency, reason, requested_by, scope)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [invoiceId, r.payment_id, r.provider, amount, r.currency, reason.trim(), user.id, scope],
  );
  return {
    refundId: ins.rows[0]!.id,
    provider: r.provider as RequestedRefund["provider"],
    paymentRef: r.provider_ref,
    amountCents: amount,
    currency: r.currency,
    scope,
  };
}

/** Teilbetrag anteilig auf die Positionen verteilen; die letzte Position nimmt den Rundungsrest. */
export function splitRefund(
  items: { grossCents: number; taxRateBp: number }[],
  refundCents: number,
): { grossCents: number; netCents: number; taxCents: number }[] {
  const total = items.reduce((t, i) => t + i.grossCents, 0);
  if (total <= 0) throw new RefundError("Rechnung ohne Betrag");
  let rest = refundCents;
  return items.map((it, idx) => {
    const g = idx === items.length - 1 ? rest : Math.round((refundCents * it.grossCents) / total);
    rest -= g;
    const tax = it.taxRateBp > 0 ? Math.round((g * it.taxRateBp) / (10000 + it.taxRateBp)) : 0;
    return { grossCents: g, netCents: g - tax, taxCents: tax };
  });
}

export async function failRefund(client: pg.ClientBase, refundId: string, errorCode: string) {
  await client.query(`update app.refunds set status = 'fehlgeschlagen', error_code = $2 where id = $1 and status = 'angefordert'`, [
    refundId,
    errorCode.slice(0, 200),
  ]);
}

/**
 * Bestätigte Erstattung verbuchen. Voll: Stornorechnung über den ganzen Betrag mit umgekehrten
 * Positionen. Teil: Rechnungskorrektur über den Teilbetrag, anteilig je Position und Steuersatz.
 * Dazu PDF, E-Mail, Erstattungsbuchung und Statusfortschreibung. Ist mit der Teilerstattung die
 * ganze Rechnung erstattet, gilt die Rate als storniert wie bei der vollen Erstattung.
 */
export async function completeRefund(client: pg.ClientBase, refundId: string, providerRefundId: string): Promise<{ stornoInvoiceId: string; stornoNumber: string; scope: "voll" | "teil" }> {
  const ref = (
    await client.query<{ invoice_id: string; payment_id: string; provider: string; amount_cents: string; currency: string; status: string; storno_invoice_id: string | null; scope: "voll" | "teil" }>(
      `select invoice_id, payment_id, provider, amount_cents, currency, status, storno_invoice_id, scope from app.refunds where id = $1 for update`,
      [refundId],
    )
  ).rows[0];
  if (!ref) throw new RefundError("Erstattung gibt es nicht");
  if (ref.status === "erstattet") {
    const n = await client.query<{ invoice_number: string }>(`select invoice_number from app.invoices where id = $1`, [ref.storno_invoice_id]);
    return { stornoInvoiceId: ref.storno_invoice_id!, stornoNumber: n.rows[0]!.invoice_number, scope: ref.scope };
  }
  if (ref.status !== "angefordert") throw new RefundError(`Erstattung hat den Status ${ref.status}`);
  const amount = Number(ref.amount_cents);

  let s: { id: string; invoice_number: string; order_id: string };
  if (ref.scope === "voll") {
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
    s = storno.rows[0]!;
    await client.query(
      `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
       select $1, position, description, -quantity, unit_net_cents, -net_cents, tax_rate_bp, -tax_cents, -gross_cents, tax_exemption_note
         from app.invoice_items where invoice_id = $2 order by position`,
      [s.id, ref.invoice_id],
    );
  } else {
    const items = (
      await client.query<{ position: number; description: string; tax_rate_bp: number; gross_cents: string; tax_exemption_note: string | null }>(
        `select position, description, tax_rate_bp, gross_cents, tax_exemption_note from app.invoice_items where invoice_id = $1 order by position`,
        [ref.invoice_id],
      )
    ).rows;
    const parts = splitRefund(items.map((i) => ({ grossCents: Number(i.gross_cents), taxRateBp: i.tax_rate_bp })), amount);
    const lines = items.map((it, k) => ({ ...it, ...parts[k]! })).filter((l) => l.grossCents !== 0);
    const net = lines.reduce((t, l) => t + l.netCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);
    const euro = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} ${ref.currency}`;
    const korr = await client.query<{ id: string; invoice_number: string; order_id: string }>(
      `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
         customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
       select company_id, 0, '', 'korrektur', id, order_id, customer_id, customer_snapshot, company_snapshot,
              (now() at time zone 'Europe/Berlin')::date, service_date_from, service_date_to, currency,
              $2::bigint, $3::bigint, $4::bigint,
              'Rechnungskorrektur zu Rechnung ' || invoice_number || ': Teilerstattung über ' || $5 || '.'
         from app.invoices where id = $1
       returning id, invoice_number, order_id`,
      [ref.invoice_id, -net, -tax, -amount, euro(amount)],
    );
    s = korr.rows[0]!;
    let pos = 0;
    for (const l of lines) {
      await client.query(
        `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
         values ($1, $2, $3, -1, $4, $5, $6, $7, $8, $9)`,
        [s.id, ++pos, `Teilerstattung: ${l.description}`, l.netCents, -l.netCents, l.tax_rate_bp, -l.taxCents, -l.grossCents, l.tax_exemption_note],
      );
    }
  }
  await client.query(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, $2, $3, 'erstattet', $4, $5, now())`,
    [s.order_id, ref.provider, providerRefundId, ref.currency, -amount],
  );
  await client.query(
    `update app.refunds set status = 'erstattet', provider_refund_id = $2, storno_invoice_id = $3, completed_at = now() where id = $1`,
    [refundId, providerRefundId, s.id],
  );
  const whole = ref.scope === "voll" || (await refundableCents(client, ref.invoice_id)) === 0;
  if (whole) {
    await client.query(`update app.order_installments set status = 'storniert' where invoice_id = $1`, [ref.invoice_id]);
    // Ist nichts Bezahltes mehr übrig, ist die Bestellung erstattet.
    await client.query(
      `update app.orders o set status = 'erstattet'
        where o.id = $1 and not exists (select 1 from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt')`,
      [s.order_id],
    );
  }
  await storeInvoicePdf(client, s.id);
  await enqueueInvoiceMail(client, s.id);
  await enqueueWebhook(client, whole ? "zahlung.erstattet" : "zahlung.teilerstattet", s.order_id, {
    refund: { provider: ref.provider, gross_cents: amount, storno_number: s.invoice_number, scope: ref.scope },
  });
  return { stornoInvoiceId: s.id, stornoNumber: s.invoice_number, scope: ref.scope };
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
