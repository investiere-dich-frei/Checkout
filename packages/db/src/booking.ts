import type pg from "pg";
import { enqueueInvoiceMail } from "./customer-mails.ts";
import { storeInvoicePdf } from "./invoice-pdf.ts";
import { enqueueWebhook } from "./webhooks.ts";
import { PaymentError, recordInstallmentPayment, type PaymentInput } from "./invoicing.ts";

/** Ergebnis einer Zahlungsmeldung, gleich für alle Zahlungsanbieter. */
export type BookingOutcome = "gebucht" | "schon_gebucht" | "ignoriert" | "pruefen";

export interface Decision {
  outcome: BookingOutcome;
  note: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /**
   * Zahlung stammt nicht aus diesem System (z. B. noch über Thrivecart auf demselben Konto).
   * Dann wird nur ID und Art des Ereignisses abgelegt, keine Kundendaten.
   */
  foreign?: true;
}

/**
 * Testzahlungen nur in einer Testdatenbank verbuchen, echte nur in der echten.
 * Gibt eine Entscheidung „pruefen“ zurück, wenn Zahlung und Gesellschaft nicht zusammenpassen.
 */
export async function paymentsModeMismatch(client: pg.ClientBase, installmentId: string, live: boolean): Promise<Decision | null> {
  const { rows } = await client.query<{ payments_mode: "live" | "test" }>(
    `select c.payments_mode
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.companies c on c.id = o.company_id
      where i.id = $1`,
    [installmentId],
  );
  const mode = rows[0]?.payments_mode ?? "live";
  if (live === (mode === "live")) return null;
  return {
    outcome: "pruefen",
    note: live ? "Echte Zahlung, die Datenbank ist im Testbetrieb" : "Testzahlung, die Datenbank ist im Live-Betrieb",
    ...NO_INVOICE,
  };
}

/** Was von einem fremden Ereignis gespeichert wird: nur der Verweis, kein Inhalt. */
export function foreignPayload(id: string, type: string) {
  return { id, type, hinweis: "Zahlung nicht aus diesem System, Inhalt nicht gespeichert" };
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
    // PDF und E-Mail entstehen in derselben Transaktion wie die Rechnung, genau einmal.
    if (booked.created) {
      await storeInvoicePdf(client, booked.invoiceId);
      await enqueueInvoiceMail(client, booked.invoiceId);
      const inst = (
        await client.query<{ order_id: string; seq: number; gross_cents: string }>(
          `select order_id, seq, gross_cents from app.order_installments where id = $1`,
          [input.installmentId],
        )
      ).rows[0]!;
      await enqueueWebhook(client, "zahlung.eingegangen", inst.order_id, {
        payment: { provider: input.provider, seq: inst.seq, first: inst.seq === 1, gross_cents: Number(inst.gross_cents), invoice_number: booked.invoiceNumber },
      });
    }
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
