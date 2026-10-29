/**
 * Beträge und Zahlpläne. Alle Beträge sind ganze Cent, Steuersätze Basispunkte.
 */

export type AmountBasis = "brutto" | "netto";
export type PriceKind = "einmal" | "raten" | "abo" | "anzahlung";

export interface Amounts {
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Ganzzahlige Division mit kaufmännischer Rundung (ab ,5 aufwärts), für nicht negative Werte. */
function divRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} muss ein Centbetrag ≥ 0 sein: ${value}`);
}

/**
 * Teilt einen Betrag in Netto, Steuer und Brutto.
 * Bei Bruttopreisen bleibt der Bruttobetrag exakt erhalten, die Rundung trägt der Nettobetrag.
 */
export function splitAmount(amountCents: number, basis: AmountBasis, rateBp: number): Amounts {
  assertCents(amountCents, "Betrag");
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new Error(`Ungültiger Steuersatz: ${rateBp}`);
  if (basis === "netto") {
    const taxCents = divRound(amountCents * rateBp, 10000);
    return { netCents: amountCents, taxCents, grossCents: amountCents + taxCents };
  }
  const netCents = divRound(amountCents * 10000, 10000 + rateBp);
  return { netCents, taxCents: amountCents - netCents, grossCents: amountCents };
}

export interface PricePlan {
  kind: PriceKind;
  amountCents: number;
  recurringAmountCents: number | null;
  /** Anzahl der Folgezahlungen; null = unbegrenzt (Abo). */
  recurringCount: number | null;
  intervalMonths: number | null;
  /** Tage bis zur ersten Folgezahlung; null = ein Intervall. */
  trialDays: number | null;
}

export interface ScheduledPayment {
  /** Fälligkeit als Kalendertag (YYYY-MM-DD, Zeitzone Europe/Berlin beim Aufrufer). */
  dueDate: string;
  amountCents: number;
}

function parseDay(day: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Ungültiges Datum: ${day}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Addiert Monate; fehlt der Tag im Zielmonat, gilt dessen letzter Tag (31.01. + 1 Monat = 28./29.02.). */
export function addMonths(day: string, months: number): string {
  const { y, m, d } = parseDay(day);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return formatDay(target);
}

export function addDays(day: string, days: number): string {
  const { y, m, d } = parseDay(day);
  return formatDay(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * Zahlungen eines Plans ab dem Kaufdatum. Bei Abos ohne Ende werden höchstens
 * `limit` Zahlungen geliefert. Eine erste Zahlung von 0 (Probezeit) entfällt.
 */
export function paymentSchedule(plan: PricePlan, purchaseDay: string, limit = 24): ScheduledPayment[] {
  const payments: ScheduledPayment[] = [];
  if (plan.amountCents > 0) payments.push({ dueDate: purchaseDay, amountCents: plan.amountCents });
  if (plan.kind === "einmal") return payments;

  if (plan.recurringAmountCents === null || plan.intervalMonths === null) {
    throw new Error(`Zahlplan ${plan.kind} ohne Folgebetrag oder Intervall`);
  }
  const count = plan.recurringCount ?? Number.POSITIVE_INFINITY;
  // Immer vom selben Stichtag aus rechnen, damit der 31. nicht über kurze Monate abwandert.
  const anchor = plan.trialDays ? addDays(purchaseDay, plan.trialDays) : purchaseDay;
  const offset = plan.trialDays ? 0 : 1;
  for (let i = 0; i < count && payments.length < limit; i++) {
    payments.push({ dueDate: addMonths(anchor, (i + offset) * plan.intervalMonths), amountCents: plan.recurringAmountCents });
  }
  return payments;
}

/** Gesamtpreis für die Preisangabe (PAngV). Bei Abos ohne Ende gibt es keinen, dann null. */
export function totalCents(plan: PricePlan): number | null {
  if (plan.kind === "einmal") return plan.amountCents;
  if (plan.recurringCount === null || plan.recurringAmountCents === null) return null;
  return plan.amountCents + plan.recurringCount * plan.recurringAmountCents;
}
