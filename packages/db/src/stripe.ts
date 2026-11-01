import type pg from "pg";
import { rememberPaymentMethod } from "./billing.ts";
import { bookPayment, foreignPayload, NO_INVOICE, paymentsModeMismatch, type BookingOutcome, type Decision, type HandledEvent } from "./booking.ts";

export type { HandledEvent } from "./booking.ts";

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
        -- Bestellung per Rechnung: Bezahlt wird per Überweisung, nicht auf der Bestellseite.
        and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
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

export interface CardSetupTarget {
  orderId: string;
  customerId: string;
  email: string;
  name: string;
  stripeCustomerId: string | null;
  currency: string;
  /** Erste spätere Fälligkeit, die automatisch eingezogen wird. */
  firstDueDate: string;
  firstGrossCents: number;
}

/**
 * Bestellung, bei der heute nichts fällig ist, später aber eingezogen wird
 * (Probezeit ohne Anzahlung), und für die noch keine Zahlungsart hinterlegt ist.
 * Dann hinterlegt die Kundin jetzt ihre Karte, ohne dass etwas abgebucht wird.
 * null, wenn nichts zu hinterlegen ist.
 */
export async function cardSetupTarget(client: pg.Pool | pg.ClientBase, orderId: string): Promise<CardSetupTarget | null> {
  const { rows } = await client.query(
    `select o.id order_id, o.customer_id, c.email,
            coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) as name,
            c.stripe_customer_id, o.currency, i.due_date::text, i.gross_cents
       from app.orders o
       join app.customers c on c.id = o.customer_id
       join app.order_installments i on i.order_id = o.id
      where o.id = $1 and o.status not in ('storniert', 'erstattet') and i.status in ('offen', 'fehlgeschlagen')
        and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
        and not exists (select 1 from app.order_installments b where b.order_id = o.id and b.status = 'bezahlt')
        and not exists (select 1 from app.saved_payment_methods s where s.customer_id = o.customer_id and s.revoked_at is null)
      order by i.seq
      limit 1`,
    [orderId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    orderId: r.order_id,
    customerId: r.customer_id,
    email: r.email,
    name: r.name,
    stripeCustomerId: r.stripe_customer_id,
    currency: r.currency,
    firstDueDate: r.due_date,
    firstGrossCents: Number(r.gross_cents),
  };
}

/**
 * Bei Stripe hinterlegte Karte zur Bestellung merken, nachdem die Kundin sie
 * bestätigt hat. Prüft, dass die Hinterlegung zu dieser Bestellung gehört.
 */
export async function rememberCardSetup(
  client: pg.Pool | pg.ClientBase,
  input: { orderId: string; setupOrderId: string | null; status: string; paymentMethod: string | null; stripeCustomerId: string | null },
): Promise<boolean> {
  if (input.setupOrderId !== input.orderId || input.status !== "succeeded" || !input.paymentMethod) return false;
  const { rows } = await client.query(`select customer_id from app.orders where id = $1`, [input.orderId]);
  if (!rows[0]) return false;
  await rememberPaymentMethod(client, {
    customerId: rows[0].customer_id,
    provider: "stripe",
    ref: input.paymentMethod,
    providerCustomer: input.stripeCustomerId,
  });
  return true;
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
  /** false bei Ereignissen aus dem Stripe-Testmodus; fehlt die Angabe, gilt live. */
  livemode?: boolean;
  paymentIntent?: {
    id: string;
    status: string;
    amountReceived: number;
    currency: string;
    metadata: Record<string, string>;
    /** Gespeicherte Zahlungsmethode (pm_…), wenn sie für spätere Einzüge freigegeben ist. */
    savedPaymentMethod?: string | null;
    stripeCustomer?: string | null;
  };
}

/**
 * Stripe-Ereignis verbuchen. Läuft in der Transaktion des Aufrufers.
 *
 * Nur payment_intent.succeeded führt zu Zahlung und Rechnung, und nur, wenn die
 * Zahlungsabsicht von diesem System angelegt wurde und Betrag und Währung genau
 * zur Fälligkeit passen. Passt etwas nicht, wird nichts gebucht und das Ereignis
 * als „pruefen“ abgelegt: Das Geld ist dann bei Stripe, aber ohne Rechnung.
 */
export async function handleStripeEvent(client: pg.ClientBase, event: StripeEventInput): Promise<HandledEvent> {
  const seen = await client.query<{ outcome: BookingOutcome; outcome_note: string | null; invoice_number: string | null }>(
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
    [
      event.id,
      event.type,
      event.paymentIntent?.id ?? null,
      result.outcome,
      result.note,
      result.invoiceId,
      JSON.stringify(result.foreign ? foreignPayload(event.id, event.type) : event.payload),
    ],
  );
  return { outcome: result.outcome, note: result.note, invoiceNumber: result.invoiceNumber, firstDelivery: true };
}

async function decide(
  client: pg.ClientBase,
  event: StripeEventInput,
): Promise<Decision> {
  const none = NO_INVOICE;
  const pi = event.paymentIntent;
  if (event.type !== "payment_intent.succeeded" || !pi) return { outcome: "ignoriert", note: null, ...none };
  if (pi.status !== "succeeded") return { outcome: "pruefen", note: `Status ${pi.status}`, ...none };

  const known = await client.query<{
    installment_id: string;
    amount_cents: string;
    currency: string;
    gross_cents: string;
    order_currency: string;
    customer_id: string;
  }>(
    `select p.installment_id, p.amount_cents, p.currency, i.gross_cents, o.currency order_currency, o.customer_id
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
      : { outcome: "ignoriert", note: "Zahlungsabsicht nicht aus diesem System", ...none, foreign: true };
  }
  if (pi.metadata.installment_id && pi.metadata.installment_id !== k.installment_id) {
    return { outcome: "pruefen", note: "Fälligkeit in den Metadaten passt nicht", ...none };
  }
  const mismatch = await paymentsModeMismatch(client, k.installment_id, event.livemode ?? true);
  if (mismatch) return mismatch;
  const currency = pi.currency.toUpperCase();
  if (currency !== k.order_currency || pi.amountReceived !== Number(k.gross_cents)) {
    return {
      outcome: "pruefen",
      note: `Erhalten ${pi.amountReceived} ${currency}, erwartet ${k.gross_cents} ${k.order_currency}`,
      ...none,
    };
  }

  const booked = await bookPayment(client, {
    installmentId: k.installment_id,
    provider: "stripe",
    providerRef: pi.id,
    paidAt: new Date(event.created * 1000),
  });
  if (booked.outcome === "gebucht" && pi.savedPaymentMethod) {
    await rememberPaymentMethod(client, {
      customerId: k.customer_id,
      provider: "stripe",
      ref: pi.savedPaymentMethod,
      providerCustomer: pi.stripeCustomer ?? null,
    });
  }
  return booked;
}
