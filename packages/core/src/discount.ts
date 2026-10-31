/**
 * Gutscheine: Rabatt auf die Zahlungen eines Zahlplans.
 *
 * Der Rabatt mindert den Preis, so wie er in der Preisoption steht (brutto oder
 * netto). Erst danach wird die Steuer berechnet. So ist der Rabatt eine im Voraus
 * vereinbarte Minderung des Entgelts und steckt schon im Rechnungsbetrag.
 *
 * „erste“: nur die erste Zahlung mit Betrag wird gemindert (bei Raten die erste
 * Rate bzw. Anzahlung, beim Abo die erste Abo-Zahlung). „alle“: jede Zahlung.
 */

import type { PricePlan, ScheduledPayment } from "./pricing.ts";

export type DiscountKind = "prozent" | "betrag";
export type DiscountScope = "erste" | "alle";

export interface Discount {
  kind: DiscountKind;
  /** Bei „prozent“: Rabatt in Basispunkten (1000 = 10 %). */
  percentBp: number | null;
  /** Bei „betrag“: Abzug je geminderter Zahlung in Cent. */
  amountCents: number | null;
  scope: DiscountScope;
}

/** Keine geminderte Zahlung darf darunter fallen (Mindestbetrag der Zahlungsanbieter mit Puffer). */
export const MIN_PAYMENT_CENTS = 100;

export class DiscountError extends Error {}

function divRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function validateDiscount(d: Discount): void {
  if (d.kind === "prozent") {
    if (!Number.isInteger(d.percentBp) || d.percentBp! < 1 || d.percentBp! > 9999) {
      throw new DiscountError("Der Prozentsatz muss zwischen 0,01 und 99,99 liegen");
    }
  } else if (!Number.isSafeInteger(d.amountCents) || d.amountCents! < 1) {
    throw new DiscountError("Der Rabattbetrag muss größer als 0 sein");
  }
}

/** Wie viel von einer Zahlung abgezogen wird. */
export function discountOn(amountCents: number, d: Discount): number {
  if (amountCents <= 0) return 0;
  if (d.kind === "prozent") return divRound(amountCents * d.percentBp!, 10000);
  return Math.min(d.amountCents!, amountCents);
}

function reduce(amountCents: number, d: Discount): number {
  if (amountCents <= 0) return amountCents;
  const reduced = amountCents - discountOn(amountCents, d);
  if (reduced < Math.min(MIN_PAYMENT_CENTS, amountCents)) {
    throw new DiscountError("Der Gutschein ist für dieses Angebot zu hoch");
  }
  return reduced;
}

export interface DiscountedPayment extends ScheduledPayment {
  /** Betrag ohne Gutschein. */
  listAmountCents: number;
}

/** Mindert die Zahlungen eines Zahlplans. Die erste Zahlung ist die erste mit Betrag. */
export function applyDiscount(schedule: ScheduledPayment[], d: Discount): DiscountedPayment[] {
  validateDiscount(d);
  return schedule.map((s, i) => ({
    dueDate: s.dueDate,
    listAmountCents: s.amountCents,
    amountCents: d.scope === "alle" || i === 0 ? reduce(s.amountCents, d) : s.amountCents,
  }));
}

/**
 * Plan mit Gutschein auf allen Zahlungen, für die festgeschriebenen Abo-Bedingungen.
 * Bei „erste“ bleibt der Plan unverändert: Der Rabatt steckt dann nur in der ersten Fälligkeit.
 */
export function discountedPlan(plan: PricePlan, d: Discount): PricePlan {
  validateDiscount(d);
  if (d.scope !== "alle") return plan;
  return {
    ...plan,
    amountCents: reduce(plan.amountCents, d),
    recurringAmountCents: plan.recurringAmountCents === null ? null : reduce(plan.recurringAmountCents, d),
  };
}

/** Kurzbeschreibung für Kaufseite und Rechnung, z. B. „10 % Rabatt“ oder „20,00 € Rabatt“. */
export function describeDiscount(d: Discount, currency = "EUR", basis: "brutto" | "netto" = "brutto"): string {
  if (d.kind === "prozent") return `${(d.percentBp! / 100).toLocaleString("de-DE")} % Rabatt`;
  const money = new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(d.amountCents! / 100);
  return `${money}${basis === "netto" ? " netto" : ""} Rabatt`;
}

/** Gutscheincodes: Großbuchstaben, Ziffern, Bindestrich, Unterstrich; 3 bis 40 Zeichen. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
