import type pg from "pg";
import { rememberPaymentMethod } from "./billing.ts";
import { bookPayment, foreignPayload, NO_INVOICE, paymentsModeMismatch, type BookingOutcome, type Decision, type HandledEvent } from "./booking.ts";

/**
 * Datenbankseite der PayPal-Bezahlung. Die Web-App spricht mit PayPal und reicht
 * hier nur die Werte herein, die verbucht werden.
 */

/** Angelegte PayPal-Bestellung festhalten. */
export async function rememberPaypalOrder(
  client: pg.Pool | pg.ClientBase,
  input: { id: string; installmentId: string; amountCents: number; currency: string },
) {
  await client.query(
    `insert into app.paypal_orders (id, installment_id, amount_cents, currency) values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [input.id, input.installmentId, input.amountCents, input.currency.toUpperCase()],
  );
}

/** Die Teile einer PayPal-Zahlung (Capture), die für die Verbuchung zählen. */
export interface PaypalCaptureInput {
  /** Webhook-Ereignis-ID, oder „capture:<id>“ für die direkte Bestätigung nach der Freigabe. */
  eventId: string;
  type: string;
  paypalOrderId: string | null;
  capture: {
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    customId: string | null;
    /** Zeitpunkt der Zahlung laut PayPal. */
    createdAt: Date;
  } | null;
  /** Gespeichertes PayPal-Konto (Vault-ID) für spätere Einzüge, falls PayPal es angelegt hat. */
  vaultId?: string | null;
  payload: unknown;
  /** false bei Zahlungen aus der PayPal-Sandbox; fehlt die Angabe, gilt live. */
  live?: boolean;
}

/**
 * PayPal-Zahlung verbuchen. Läuft in der Transaktion des Aufrufers.
 *
 * Gebucht wird nur eine abgeschlossene Zahlung (COMPLETED) zu einer PayPal-Bestellung,
 * die dieses System angelegt hat, mit genau passendem Betrag und Währung. Eine
 * ausstehende Zahlung (PENDING) wird nicht gebucht; PayPal meldet den Abschluss später.
 */
export async function handlePaypalCapture(client: pg.ClientBase, input: PaypalCaptureInput): Promise<HandledEvent> {
  const seen = await client.query<{ outcome: BookingOutcome; outcome_note: string | null; invoice_number: string | null }>(
    `select e.outcome, e.outcome_note, i.invoice_number
       from app.paypal_events e left join app.invoices i on i.id = e.invoice_id
      where e.id = $1`,
    [input.eventId],
  );
  if (seen.rows[0]) {
    const s = seen.rows[0];
    return { outcome: s.outcome, note: s.outcome_note, invoiceNumber: s.invoice_number, firstDelivery: false };
  }

  const result = await decide(client, input);
  await client.query(
    `insert into app.paypal_events (id, type, paypal_order, capture_id, outcome, outcome_note, invoice_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.eventId,
      input.type,
      input.paypalOrderId,
      input.capture?.id ?? null,
      result.outcome,
      result.note,
      result.invoiceId,
      JSON.stringify(result.foreign ? foreignPayload(input.eventId, input.type) : input.payload),
    ],
  );
  return { outcome: result.outcome, note: result.note, invoiceNumber: result.invoiceNumber, firstDelivery: true };
}

async function decide(client: pg.ClientBase, input: PaypalCaptureInput): Promise<Decision> {
  const none = NO_INVOICE;
  const cap = input.capture;
  if (!cap) return { outcome: "ignoriert", note: null, ...none };
  if (cap.status === "PENDING") return { outcome: "ignoriert", note: "Zahlung bei PayPal noch ausstehend", ...none };

  const known = input.paypalOrderId
    ? (
        await client.query<{ installment_id: string; gross_cents: string; order_currency: string; customer_id: string }>(
          `select p.installment_id, i.gross_cents, o.currency order_currency, o.customer_id
             from app.paypal_orders p
             join app.order_installments i on i.id = p.installment_id
             join app.orders o on o.id = i.order_id
            where p.id = $1`,
          [input.paypalOrderId],
        )
      ).rows[0]
    : undefined;
  // Zahlungen, die nicht aus diesem System stammen (z. B. noch über Thrivecart), gehen uns nichts an.
  if (!known) {
    return cap.customId
      ? { outcome: "pruefen", note: "PayPal-Bestellung unbekannt, trägt aber eine Fälligkeit", ...none }
      : { outcome: "ignoriert", note: "PayPal-Bestellung nicht aus diesem System", ...none, foreign: true };
  }
  if (cap.status !== "COMPLETED") return { outcome: "pruefen", note: `Status ${cap.status}`, ...none };
  if (cap.customId && cap.customId !== known.installment_id) {
    return { outcome: "pruefen", note: "Fälligkeit in custom_id passt nicht", ...none };
  }
  const mismatch = await paymentsModeMismatch(client, known.installment_id, input.live ?? true);
  if (mismatch) return mismatch;
  const currency = cap.currency.toUpperCase();
  if (currency !== known.order_currency || cap.amountCents !== Number(known.gross_cents)) {
    return {
      outcome: "pruefen",
      note: `Erhalten ${cap.amountCents} ${currency}, erwartet ${known.gross_cents} ${known.order_currency}`,
      ...none,
    };
  }
  const booked = await bookPayment(client, {
    installmentId: known.installment_id,
    provider: "paypal",
    providerRef: cap.id,
    paidAt: cap.createdAt,
  });
  if (booked.outcome === "gebucht" && input.vaultId) {
    await rememberPaymentMethod(client, { customerId: known.customer_id, provider: "paypal", ref: input.vaultId });
  }
  return booked;
}

/** PayPal-Betrag („1665.67“) in Cent. Nur Währungen mit zwei Nachkommastellen (EUR, CHF). */
export function paypalAmountToCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new Error(`Ungültiger PayPal-Betrag: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Cent in PayPal-Betrag („1665.67“). */
export function centsToPaypalAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Ungültiger Betrag: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
