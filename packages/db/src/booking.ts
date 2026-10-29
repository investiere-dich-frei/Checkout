import type pg from "pg";
import { enqueueInvoiceMail } from "./customer-mails.ts";
import { PaymentError, recordInstallmentPayment, type PaymentInput } from "./invoicing.ts";

/** Ergebnis einer Zahlungsmeldung, gleich für alle Zahlungsanbieter. */
export type BookingOutcome = "gebucht" | "schon_gebucht" | "ignoriert" | "pruefen";

export interface Decision {
  outcome: BookingOutcome;
  note: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface HandledEvent {
  outcome: BookingOutcome;
  note: string | null;
  invoiceNumber: string | null;
  /** false, wenn dieses Ereignis schon einmal ankam. */
  firstDelivery: boolean;
}

export const NO_INVOICE = { invoiceId: null, invoiceNumber: null } as const;

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/**
 * Geprüfte Zahlung verbuchen und die Rechnung per E-Mail auf den Weg bringen. Scheitert die Verbuchung fachlich (z. B. Rate schon
 * anders bezahlt), wird nichts gebucht und das Ergebnis lautet „pruefen“. Der
 * Savepoint hält die Transaktion des Aufrufers dabei benutzbar, damit die Meldung
 * trotzdem abgelegt werden kann.
 */
export async function bookPayment(
  client: pg.ClientBase,
  input: { installmentId: string; provider: PaymentInput["provider"]; providerRef: string; paidAt: Date },
): Promise<Decision> {
  await client.query("savepoint payment_booking");
  try {
    const booked = await recordInstallmentPayment(client, { ...input, issueDay: berlinDay.format(input.paidAt) });
    // Die Rechnung geht mit derselben Transaktion in den Postausgang, genau einmal.
    if (booked.created) await enqueueInvoiceMail(client, booked.invoiceId);
    await client.query("release savepoint payment_booking");
    return {
      outcome: booked.created ? "gebucht" : "schon_gebucht",
      note: null,
      invoiceId: booked.invoiceId,
      invoiceNumber: booked.invoiceNumber,
    };
  } catch (err) {
    await client.query("rollback to savepoint payment_booking");
    if (err instanceof PaymentError) return { outcome: "pruefen", note: err.message, ...NO_INVOICE };
    throw err;
  }
}
