import type pg from "pg";
import { PaymentError, recordInstallmentPayment } from "./invoicing.ts";

/**
 * Datenbankseite der Stripe-Bezahlung. Kennt das Stripe-SDK nicht: Die Web-App
 * spricht mit Stripe und reicht hier nur die Werte herein, die verbucht werden.
 */

export interface PaymentTarget {
  installmentId: string;
  seq: number;
  orderId: string;
  customerId: string;
  email: string;
  name: string;
  stripeCustomerId: string | null;
  currency: string;
  grossCents: number;
  /** Zuletzt angelegte Zahlungsabsicht zu dieser Fälligkeit, falls vorhanden. */
  paymentIntentId: string | null;
  /** Die Option hat weitere Fälligkeiten (Raten, Abo); die Zahlungsart wird dann für später gespeichert. */
  recurring: boolean;
}

/**
 * Erste offene Fälligkeit einer Bestellung, die bis dueBy (YYYY-MM-DD) fällig ist.
 * null, wenn jetzt nichts zu bezahlen ist. Spätere Raten zieht ein eigener Lauf ein.
 */
export async function nextPaymentTarget(
  client: pg.Pool | pg.ClientBase,
  orderId: string,
  dueBy: string,
): Promise<PaymentTarget | null> {
  const { rows } = await client.query(
    `select i.id, i.seq, i.order_id, o.customer_id, c.email,
            coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) as name,
            c.stripe_customer_id, o.currency, i.gross_cents,
            (select p.id from app.stripe_payment_intents p where p.installment_id = i.id
              order by p.created_at desc limit 1) as payment_intent_id,
            (select count(*) from app.order_installments x where x.order_item_id = i.order_item_id) > 1
              or po.kind = 'abo' as recurring
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
      where i.order_id = $1 and i.status in ('offen', 'fehlgeschlagen') and i.due_date <= $2
        and o.status not in ('storniert', 'erstattet')
      order by i.seq
      limit 1`,
    [orderId, dueBy],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    installmentId: r.id,
    seq: r.seq,
    orderId: r.order_id,
    customerId: r.customer_id,
    email: r.email,
    name: r.name,
    stripeCustomerId: r.stripe_customer_id,
    currency: r.currency,
    grossCents: Number(r.gross_cents),
    paymentIntentId: r.payment_intent_id,
    recurring: r.recurring,
  };
}

/** Stripe-Kunden am Kunden vermerken. Ein schon gesetzter Verweis bleibt. */
export async function rememberStripeCustomer(client: pg.Pool | pg.ClientBase, customerId: string, stripeCustomerId: string) {
  await client.query(`update app.customers set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null`, [
    customerId,
    stripeCustomerId,
  ]);
}

/** Angelegte Zahlungsabsicht festhalten. Doppelte Meldungen derselben Absicht sind harmlos. */
export async function rememberPaymentIntent(
  client: pg.Pool | pg.ClientBase,
  input: { id: string; installmentId: string; amountCents: number; currency: string },
) {
  await client.query(
    `insert into app.stripe_payment_intents (id, installment_id, amount_cents, currency) values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [input.id, input.installmentId, input.amountCents, input.currency.toUpperCase()],
  );
}

/** Die Teile eines Stripe-Ereignisses, die für die Verbuchung zählen. */
export interface StripeEventInput {
  id: string;
  type: string;
  /** Zeitpunkt des Ereignisses in Sekunden seit 1970 (Stripe: created). */
  created: number;
  /** Vollständiger Inhalt, wird als Nachweis abgelegt. */
  payload: unknown;
  paymentIntent?: {
    id: string;
    status: string;
    amountReceived: number;
    currency: string;
    metadata: Record<string, string>;
  };
}

export type StripeOutcome = "gebucht" | "schon_gebucht" | "ignoriert" | "pruefen";

export interface HandledEvent {
  outcome: StripeOutcome;
  note: string | null;
  invoiceNumber: string | null;
  /** false, wenn dieses Ereignis schon einmal ankam. */
  firstDelivery: boolean;
}

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/**
 * Stripe-Ereignis verbuchen. Läuft in der Transaktion des Aufrufers.
 *
 * Nur payment_intent.succeeded führt zu Zahlung und Rechnung, und nur, wenn die
 * Zahlungsabsicht von diesem System angelegt wurde und Betrag und Währung genau
 * zur Fälligkeit passen. Passt etwas nicht, wird nichts gebucht und das Ereignis
 * als „pruefen“ abgelegt: Das Geld ist dann bei Stripe, aber ohne Rechnung.
 */
export async function handleStripeEvent(client: pg.ClientBase, event: StripeEventInput): Promise<HandledEvent> {
  const seen = await client.query<{ outcome: StripeOutcome; outcome_note: string | null; invoice_number: string | null }>(
    `select e.outcome, e.outcome_note, i.invoice_number
       from app.stripe_events e left join app.invoices i on i.id = e.invoice_id
      where e.id = $1`,
    [event.id],
  );
  if (seen.rows[0]) {
    const s = seen.rows[0];
    return { outcome: s.outcome, note: s.outcome_note, invoiceNumber: s.invoice_number, firstDelivery: false };
  }

  const result = await decide(client, event);
  await client.query(
    `insert into app.stripe_events (id, type, payment_intent, outcome, outcome_note, invoice_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [event.id, event.type, event.paymentIntent?.id ?? null, result.outcome, result.note, result.invoiceId, JSON.stringify(event.payload)],
  );
  return { outcome: result.outcome, note: result.note, invoiceNumber: result.invoiceNumber, firstDelivery: true };
}

async function decide(
  client: pg.ClientBase,
  event: StripeEventInput,
): Promise<{ outcome: StripeOutcome; note: string | null; invoiceId: string | null; invoiceNumber: string | null }> {
  const none = { invoiceId: null, invoiceNumber: null };
  const pi = event.paymentIntent;
  if (event.type !== "payment_intent.succeeded" || !pi) return { outcome: "ignoriert", note: null, ...none };
  if (pi.status !== "succeeded") return { outcome: "pruefen", note: `Status ${pi.status}`, ...none };

  const known = await client.query<{ installment_id: string; amount_cents: string; currency: string; gross_cents: string; order_currency: string }>(
    `select p.installment_id, p.amount_cents, p.currency, i.gross_cents, o.currency order_currency
       from app.stripe_payment_intents p
       join app.order_installments i on i.id = p.installment_id
       join app.orders o on o.id = i.order_id
      where p.id = $1`,
    [pi.id],
  );
  const k = known.rows[0];
  // Zahlungen, die nicht aus diesem System stammen (z. B. noch über Thrivecart), gehen uns nichts an.
  if (!k) {
    return pi.metadata.installment_id
      ? { outcome: "pruefen", note: "Zahlungsabsicht unbekannt, trägt aber eine Fälligkeit", ...none }
      : { outcome: "ignoriert", note: "Zahlungsabsicht nicht aus diesem System", ...none };
  }
  if (pi.metadata.installment_id && pi.metadata.installment_id !== k.installment_id) {
    return { outcome: "pruefen", note: "Fälligkeit in den Metadaten passt nicht", ...none };
  }
  const currency = pi.currency.toUpperCase();
  if (currency !== k.order_currency || pi.amountReceived !== Number(k.gross_cents)) {
    return {
      outcome: "pruefen",
      note: `Erhalten ${pi.amountReceived} ${currency}, erwartet ${k.gross_cents} ${k.order_currency}`,
      ...none,
    };
  }

  const paidAt = new Date(event.created * 1000);
  // Savepoint: Scheitert die Verbuchung, bleibt die Ablage des Ereignisses trotzdem möglich.
  await client.query("savepoint stripe_booking");
  try {
    const booked = await recordInstallmentPayment(client, {
      installmentId: k.installment_id,
      provider: "stripe",
      providerRef: pi.id,
      paidAt,
      issueDay: berlinDay.format(paidAt),
    });
    await client.query("release savepoint stripe_booking");
    return {
      outcome: booked.created ? "gebucht" : "schon_gebucht",
      note: null,
      invoiceId: booked.invoiceId,
      invoiceNumber: booked.invoiceNumber,
    };
  } catch (err) {
    await client.query("rollback to savepoint stripe_booking");
    if (err instanceof PaymentError) return { outcome: "pruefen", note: err.message, ...none };
    throw err;
  }
}
