import { addDays, addMonths } from "./pricing.ts";

/**
 * Zahlungsplan einer manuellen Bestellung (Rechnung vorab, Zahlung per Überweisung),
 * wie bisher im n8n-Formular: Erfasst wird immer der Gesamtbetrag, den die Kundin
 * zahlt (brutto). Die erste Zahlung ist zum Zahlungsziel fällig, weitere Zahlungen ab
 * der „nächsten Fälligkeit“ monatlich zum gleichen Tag.
 */

export type ManualPaymentModel = "einmal" | "anzahlung_rest" | "anzahlung_raten" | "raten";

export const MANUAL_MODEL_LABEL: Record<ManualPaymentModel, string> = {
  einmal: "Einmalzahlung",
  anzahlung_rest: "Anzahlung und Restzahlung",
  anzahlung_raten: "Anzahlung und Raten",
  raten: "Ratenzahlung",
};

export interface ManualPlanInput {
  model: ManualPaymentModel;
  /** Gesamtbetrag brutto in Cent. */
  totalCents: number;
  /** Erste Zahlung brutto (Anzahlung oder Rate 1). Bei Einmalzahlung ohne Bedeutung. */
  firstCents?: number | null;
  /** Gesamtzahl der Raten (Raten: inklusive Rate 1; Anzahlung + Raten: ohne Anzahlung). */
  installmentCount?: number | null;
  /** Fälligkeit der zweiten Zahlung, YYYY-MM-DD. */
  nextDueDate?: string | null;
  /** Tag der Rechnung, YYYY-MM-DD (Europe/Berlin). */
  issueDay: string;
  /** Zahlungsziel der ersten Zahlung in Tagen ab Rechnung. */
  paymentTermDays: number;
}

export interface ManualInstallment {
  seq: number;
  label: string;
  dueDate: string;
  grossCents: number;
}

export class ManualPlanError extends Error {}

/** Höchstbetrag wie im n8n-Formular; darüber bitte Christian einbinden. */
export const MANUAL_MAX_TOTAL_CENTS = 2_000_000;

export function manualPlan(input: ManualPlanInput): ManualInstallment[] {
  const total = input.totalCents;
  if (!Number.isInteger(total) || total <= 0) throw new ManualPlanError("Der Gesamtbetrag muss größer als null sein.");
  if (total > MANUAL_MAX_TOTAL_CENTS) throw new ManualPlanError("Der Betrag liegt über 20.000 €. Bitte mit Christian klären.");
  if (!Number.isInteger(input.paymentTermDays) || input.paymentTermDays < 0 || input.paymentTermDays > 90) {
    throw new ManualPlanError("Das Zahlungsziel muss zwischen 0 und 90 Tagen liegen.");
  }
  const payBy = addDays(input.issueDay, input.paymentTermDays);
  if (input.model === "einmal") return [{ seq: 1, label: "Gesamtbetrag", dueDate: payBy, grossCents: total }];

  const first = input.firstCents ?? 0;
  if (!Number.isInteger(first) || first <= 0) throw new ManualPlanError("Die erste Zahlung fehlt.");
  if (first >= total) throw new ManualPlanError("Die erste Zahlung muss kleiner als der Gesamtbetrag sein.");
  const next = input.nextDueDate ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new ManualPlanError("Die Fälligkeit der nächsten Zahlung fehlt.");
  if (next <= payBy) throw new ManualPlanError("Die nächste Zahlung muss nach dem Zahlungsziel der ersten Zahlung liegen.");
  const rest = total - first;

  if (input.model === "anzahlung_rest") {
    return [
      { seq: 1, label: "Anzahlung", dueDate: payBy, grossCents: first },
      { seq: 2, label: "Restzahlung", dueDate: next, grossCents: rest },
    ];
  }

  const count = input.installmentCount ?? 0;
  if (!Number.isInteger(count) || count < 2 || count > 24) throw new ManualPlanError("Die Anzahl der Raten muss zwischen 2 und 24 liegen.");
  // Raten: count Raten insgesamt, Rate 1 ist die erste Zahlung. Anzahlung + Raten: count Raten nach der Anzahlung.
  const following = input.model === "raten" ? count - 1 : count;
  if (following < 1) throw new ManualPlanError("Es braucht mindestens eine weitere Rate.");
  const rate = Math.floor(rest / following);
  if (rate <= 0) throw new ManualPlanError("Die Raten wären null. Bitte die Beträge prüfen.");
  const last = rest - rate * (following - 1);
  const out: ManualInstallment[] = [
    { seq: 1, label: input.model === "raten" ? `Rate 1 von ${count}` : "Anzahlung", dueDate: payBy, grossCents: first },
  ];
  for (let i = 0; i < following; i++) {
    const nr = input.model === "raten" ? i + 2 : i + 1;
    out.push({ seq: i + 2, label: `Rate ${nr} von ${count}`, dueDate: addMonths(next, i), grossCents: i === following - 1 ? last : rate });
  }
  return out;
}
