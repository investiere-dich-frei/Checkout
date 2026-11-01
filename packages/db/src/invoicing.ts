import { describeDiscount, type Discount } from "@idf/core/discount";
import { addDays, addMonths } from "@idf/core/pricing";
import type pg from "pg";

/**
 * Zahlungseingang zu einer Fälligkeit verbuchen und die Rechnung dazu ausstellen.
 *
 * Zahlung, Rechnung, Position und Statuswechsel entstehen in der Transaktion des
 * Aufrufers, oder gar nicht. Eine halb verbuchte Zahlung kann es so nicht geben.
 * Wiederholte Meldungen derselben Zahlung (z. B. ein Webhook kommt zweimal)
 * liefern die bereits ausgestellte Rechnung zurück.
 */

export interface PaymentInput {
  installmentId: string;
  provider: "stripe" | "paypal" | "ueberweisung" | "mollie";
  /** Eindeutige Referenz des Zahlungsanbieters, z. B. die Stripe-PaymentIntent-ID. */
  providerRef: string;
  paidAt: Date;
  /** Rechnungsdatum in Europe/Berlin, YYYY-MM-DD. */
  issueDay: string;
}

export interface RecordedPayment {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  /** false, wenn die Zahlung schon verbucht war. */
  created: boolean;
}

export class PaymentError extends Error {}

interface InstallmentRow {
  id: string;
  order_id: string;
  seq: number;
  due_date: string;
  net_cents: string;
  tax_cents: string;
  gross_cents: string;
  status: string;
  payment_id: string | null;
  invoice_id: string | null;
  installment_count: number;
  company_id: string;
  customer_id: string;
  currency: string;
  order_day: string;
  order_status: string;
  tax_rate_bp: number;
  tax_note: string | null;
  kind: string;
  interval_months: number | null;
  option_label: string;
  product_name: string;
  coupon_code: string | null;
  coupon_kind: Discount["kind"] | null;
  coupon_percent_bp: number | null;
  coupon_amount_cents: string | null;
  coupon_scope: Discount["scope"] | null;
  coupon_basis: "brutto" | "netto" | null;
  first_paid_seq: number;
}

export async function recordInstallmentPayment(client: pg.ClientBase, input: PaymentInput): Promise<RecordedPayment> {
  // Die Zeilensperre verhindert, dass zwei gleichzeitige Meldungen zwei Rechnungen erzeugen.
  const { rows } = await client.query<InstallmentRow>(
    `select i.id, i.order_id, i.seq, i.due_date::text, i.net_cents, i.tax_cents, i.gross_cents, i.status,
            i.payment_id, i.invoice_id,
            (select count(*)::int from app.order_installments x where x.order_item_id = i.order_item_id) installment_count,
            o.company_id, o.customer_id, o.currency, (o.created_at at time zone 'Europe/Berlin')::date::text order_day,
            o.status order_status, it.tax_rate_bp, it.tax_note, po.kind, po.interval_months, po.label option_label,
            p.name product_name, d.code coupon_code, d.kind coupon_kind, d.percent_bp coupon_percent_bp,
            d.amount_cents coupon_amount_cents, d.scope coupon_scope, d.amount_basis coupon_basis,
            (select min(x.seq) from app.order_installments x where x.order_item_id = i.order_item_id and x.gross_cents > 0) first_paid_seq
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       left join app.order_discounts d on d.order_item_id = it.id
      where i.id = $1
      for update of i`,
    [input.installmentId],
  );
  const inst = rows[0];
  if (!inst) throw new PaymentError("Fälligkeit gibt es nicht");

  const known = await client.query<{ id: string; order_id: string }>(
    `select id, order_id from app.payments where provider = $1 and provider_ref = $2`,
    [input.provider, input.providerRef],
  );
  if (inst.invoice_id) {
    if (known.rows[0]?.id !== inst.payment_id) {
      throw new PaymentError(`Fälligkeit ${inst.seq} ist bereits mit einer anderen Zahlung beglichen`);
    }
    const inv = await client.query<{ invoice_number: string }>(`select invoice_number from app.invoices where id = $1`, [
      inst.invoice_id,
    ]);
    return { paymentId: inst.payment_id!, invoiceId: inst.invoice_id, invoiceNumber: inv.rows[0]!.invoice_number, created: false };
  }
  if (known.rowCount) throw new PaymentError("Diese Zahlung ist bereits einer anderen Fälligkeit zugeordnet");
  if (inst.status !== "offen" && inst.status !== "fehlgeschlagen") {
    throw new PaymentError(`Fälligkeit ${inst.seq} hat den Status ${inst.status}`);
  }
  if (inst.order_status === "storniert" || inst.order_status === "erstattet") {
    throw new PaymentError(`Bestellung ist ${inst.order_status}`);
  }
  // Rechnungskauf: Die Rechnung gibt es schon; Zahlungen verbucht die Verwaltung von Hand.
  const manual = await client.query(`select 1 from app.manual_orders where order_id = $1`, [inst.order_id]);
  if (manual.rowCount) throw new PaymentError("Bestellung per Rechnung: Zahlung nur per Überweisung");

  const payment = await client.query<{ id: string }>(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, $2, $3, 'bezahlt', $4, $5, $6) returning id`,
    [inst.order_id, input.provider, input.providerRef, inst.currency, inst.gross_cents, input.paidAt],
  );
  const paymentId = payment.rows[0]!.id;

  // Abo: Leistungszeitraum ist das bezahlte Intervall. Sonst der Tag der Bestellung.
  const serviceFrom = inst.kind === "abo" ? inst.due_date : inst.order_day;
  const serviceTo =
    inst.kind === "abo" && inst.interval_months
      ? addDays(addMonths(inst.due_date, inst.interval_months), -1)
      : inst.order_day;

  const invoice = await client.query<{ id: string; invoice_number: string }>(
    `insert into app.invoices (company_id, number_seq, invoice_number, kind, order_id, customer_id,
       customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency,
       net_cents, tax_cents, gross_cents)
     select $1, 0, '', 'rechnung', $2, $3, to_jsonb(cu), to_jsonb(co), $4, $5, $6, $7, $8, $9, $10
       from app.customers cu, app.companies co
      where cu.id = $3 and co.id = $1
     returning id, invoice_number`,
    [
      inst.company_id,
      inst.order_id,
      inst.customer_id,
      input.issueDay,
      serviceFrom,
      serviceTo,
      inst.currency,
      inst.net_cents,
      inst.tax_cents,
      inst.gross_cents,
    ],
  );
  const inv = invoice.rows[0]!;

  const part = inst.installment_count > 1 && inst.kind !== "abo" ? ` (Zahlung ${inst.seq} von ${inst.installment_count})` : "";
  // Gutschein: Der Rabatt steckt schon im Betrag; der Hinweis macht die Minderung nachvollziehbar.
  const discounted = inst.coupon_code !== null && (inst.coupon_scope === "alle" || inst.seq === inst.first_paid_seq);
  const couponNote = discounted
    ? ` · Gutschein ${inst.coupon_code}: ${describeDiscount(
        {
          kind: inst.coupon_kind!,
          percentBp: inst.coupon_percent_bp,
          amountCents: inst.coupon_amount_cents === null ? null : Number(inst.coupon_amount_cents),
          scope: inst.coupon_scope!,
        },
        inst.currency,
        inst.coupon_basis ?? "brutto",
      )} enthalten`
    : "";
  await client.query(
    `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents,
       tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
     values ($1, 1, $2, 1, $3, $3, $4, $5, $6, $7)`,
    [inv.id, `${inst.product_name} – ${inst.option_label}${part}${couponNote}`, inst.net_cents, inst.tax_rate_bp, inst.tax_cents, inst.gross_cents, inst.tax_note],
  );

  await client.query(`update app.order_installments set status = 'bezahlt', payment_id = $2, invoice_id = $3 where id = $1`, [
    inst.id,
    paymentId,
    inv.id,
  ]);
  await client.query(
    `update app.orders o
        set status = case when exists (
              select 1 from app.order_installments x where x.order_id = o.id and x.status in ('offen', 'fehlgeschlagen'))
            then 'teilbezahlt' else 'bezahlt' end
      where o.id = $1`,
    [inst.order_id],
  );

  return { paymentId, invoiceId: inv.id, invoiceNumber: inv.invoice_number, created: true };
}
