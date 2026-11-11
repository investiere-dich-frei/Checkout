/**
 * Ratenkauf als Kredit (Finanzierungshilfe, § 506 BGB in der Fassung ab 20.11.2026) und
 * Bonitätsprüfung per Fragebogen. Ohne Datenbank, damit Checkout, Verwaltung und Tests
 * dieselben Regeln verwenden.
 *
 * Kein Kredit ist ein Zahlplan, der höchstens 50 Tage nach Kauf vollständig bezahlt ist und
 * nichts extra kostet (Händlerausnahme § 506 Abs. 1 S. 2 Nr. 5 BGB n. F., IDF ist KMU).
 * Abos ohne Ende zahlen im Voraus und sind kein Zahlungsaufschub.
 */

import { addDays, paymentSchedule, totalCents, type PricePlan } from "./pricing.ts";

/** Ab diesem Tag gilt das neue Verbraucherkreditrecht für neue Verträge (Art. 229 § 71 EGBGB). */
export const CREDIT_LAW_START = "2026-11-20";

/** Längste Zahlungsfrist ohne Kreditrecht (Händlerausnahme für KMU). */
export const CREDIT_FREE_DAYS = 50;
/** Widerrufsfrist des Kreditvertrags (§ 495 BGB). */
export const CREDIT_WITHDRAWAL_DAYS = 14;
/** Spätestes Ende des Widerrufsrechts bei richtiger Belehrung: 12 Monate und 14 Tage (§ 356b Abs. 2 BGB n. F.). */
export const CREDIT_WITHDRAWAL_MAX_MONTHS = 12;
/** Erinnerung an das Widerrufsrecht 1 bis 7 Tage nach Vertragsschluss (Art. 247 § 2 Abs. 4 EGBGB n. F.). */
export const CREDIT_REMINDER_DAYS = 2;

export interface CreditClassification {
  /** Fällt der Plan unter das Verbraucherkreditrecht? */
  isCredit: boolean;
  /** Tag der letzten Zahlung (null ohne Zahlung oder bei Abo ohne Ende). */
  lastDueDate: string | null;
  /** Gesamtpreis aller Zahlungen; null bei Abo ohne Ende. */
  totalCents: number | null;
  /** Aufschlag gegenüber dem Barzahlungspreis (0, wenn keiner bekannt oder keiner da). */
  surchargeCents: number;
  /** Heute fällige Zahlung. */
  dueNowCents: number;
  /** Kreditbetrag: alles, was nach dem Kauftag gezahlt wird. */
  creditCents: number;
  /** Höchste Belastung je Monat aus späteren Zahlungen (Rate ÷ Abstand in Monaten, aufgerundet). */
  monthlyRateCents: number;
}

/**
 * Ordnet einen Zahlplan ein. `cashPriceCents` ist der Barzahlungspreis (Einmalzahlung desselben
 * Produkts), falls es einen gibt; ein höherer Gesamtpreis gilt als Aufschlag. Ein Aufschlag macht
 * auch kurze Pläne zum Kredit, weil die Händlerausnahme nur für unentgeltliche Fristen gilt.
 */
export function classifyCredit(plan: PricePlan, purchaseDay: string, cashPriceCents: number | null = null): CreditClassification {
  const total = totalCents(plan);
  if (plan.kind === "einmal" || (plan.kind === "abo" && plan.recurringCount === null) || total === null) {
    const now = plan.amountCents;
    return { isCredit: false, lastDueDate: purchaseDay, totalCents: total, surchargeCents: 0, dueNowCents: now, creditCents: 0, monthlyRateCents: 0 };
  }
  const schedule = paymentSchedule(plan, purchaseDay, Number.MAX_SAFE_INTEGER);
  const dueNow = schedule.filter((s) => s.dueDate === purchaseDay).reduce((t, s) => t + s.amountCents, 0);
  const later = schedule.filter((s) => s.dueDate > purchaseDay);
  const lastDueDate = schedule.length ? schedule[schedule.length - 1]!.dueDate : null;
  const surcharge = cashPriceCents !== null && total > cashPriceCents ? total - cashPriceCents : 0;
  const creditCents = later.reduce((t, s) => t + s.amountCents, 0);
  const interval = Math.max(1, plan.intervalMonths ?? 1);
  const monthlyRateCents = later.reduce((m, s) => Math.max(m, Math.ceil(s.amountCents / interval)), 0);
  const tooLong = lastDueDate !== null && lastDueDate > addDays(purchaseDay, CREDIT_FREE_DAYS);
  // Verträge vor dem Stichtag fallen unter altes Recht; damals war nur der entgeltliche Aufschub ein Kredit.
  const isCredit = creditCents > 0 && purchaseDay >= CREDIT_LAW_START && (tooLong || surcharge > 0);
  return { isCredit, lastDueDate, totalCents: total, surchargeCents: surcharge, dueNowCents: dueNow, creditCents, monthlyRateCents };
}

/** Letzter Tag der 14-tägigen Widerrufsfrist (Vertragsschluss = Kauftag, Pflichtangaben gehen am selben Tag raus). */
export function creditWithdrawalEnd(contractDay: string): string {
  return addDays(contractDay, CREDIT_WITHDRAWAL_DAYS);
}

// ---------------------------------------------------------------------------
// Bonitätsprüfung per Fragebogen
// ---------------------------------------------------------------------------

export const EMPLOYMENTS = {
  angestellt: "angestellt",
  selbststaendig: "selbstständig",
  beamtet: "verbeamtet",
  rente: "in Rente oder Pension",
  ausbildung: "in Ausbildung oder Studium",
  ohne: "derzeit ohne Beschäftigung",
} as const;
export type Employment = keyof typeof EMPLOYMENTS;

/** Antworten der Kundin. Beträge in Cent je Monat. */
export interface CreditAnswers {
  employment: Employment;
  netIncomeCents: number;
  housingCents: number;
  otherCreditsCents: number;
  /** Weitere Personen, die die Kundin finanziell mitversorgt. */
  dependents: number;
  /** Mahnverfahren, Pfändung oder Insolvenz aktuell. */
  paymentProblems: boolean;
}

/** Regeln, in der Verwaltung einstellbar. Jede Prüfung speichert eine Kopie davon. */
export interface CreditRules {
  /** Lebenshaltung ohne Wohnen für die Kundin selbst. */
  livingCostCents: number;
  /** Zuschlag je mitversorgter Person. */
  livingCostPerDependentCents: number;
  /** Grün, wenn die Monatsrate höchstens diesen Anteil des freien Einkommens ausmacht (Basispunkte). */
  greenMaxShareBp: number;
  /** Ab diesem Kreditbetrag nie automatisch grün, sondern Prüfung durch das Team (null = aus). */
  manualReviewFromCents: number | null;
  /** Ab diesem Kreditbetrag ist eine Auskunftei-Abfrage nötig (null = aus). */
  bureauFromCents: number | null;
}

export const DEFAULT_CREDIT_RULES: CreditRules = {
  livingCostCents: 60_000,
  livingCostPerDependentCents: 40_000,
  greenMaxShareBp: 5_000,
  manualReviewFromCents: null,
  bureauFromCents: null,
};

/** Kennung des Verfahrens und seiner Regeln; ändert sich, wenn sich die Logik ändert, nicht die Zahlen. */
export const QUESTIONNAIRE_RULES_VERSION = "fragebogen-1";

export type CreditResult = "gruen" | "gelb" | "rot";

export interface CreditAssessment {
  result: CreditResult;
  /** Freies Einkommen je Monat nach Wohnen, anderen Raten und Lebenshaltung. */
  freeIncomeCents: number;
  /** Begründungen in einfachen Worten, für Team und Kundin. */
  reasons: string[];
  /** Nur bei gelb: Eine Auskunftei-Abfrage ist nötig, aber noch nicht angebunden. */
  needsBureau: boolean;
}

/** Fragebogen auswerten. Reine Funktion: gleiche Eingaben, gleiches Ergebnis. */
export function assessQuestionnaire(a: CreditAnswers, credit: { monthlyRateCents: number; creditCents: number }, rules: CreditRules): CreditAssessment {
  const living = rules.livingCostCents + Math.max(0, a.dependents) * rules.livingCostPerDependentCents;
  const free = a.netIncomeCents - a.housingCents - a.otherCreditsCents - living;
  const reasons: string[] = [];
  const rate = credit.monthlyRateCents;

  if (a.paymentProblems) reasons.push("Es gibt aktuell Zahlungsprobleme (Mahnverfahren, Pfändung oder Insolvenz).");
  if (free <= 0) reasons.push("Nach Wohnen, anderen Raten und Lebenshaltung bleibt kein freies Einkommen.");
  else if (rate > free) reasons.push("Die Monatsrate ist höher als das freie Einkommen.");
  if (reasons.length) return { result: "rot", freeIncomeCents: free, reasons, needsBureau: false };

  const yellow: string[] = [];
  if (rate * 10_000 > free * rules.greenMaxShareBp) {
    yellow.push(`Die Monatsrate liegt über ${rules.greenMaxShareBp / 100} % des freien Einkommens.`);
  }
  if (a.employment === "ohne" || a.employment === "ausbildung") yellow.push(`Beschäftigung: ${EMPLOYMENTS[a.employment]}.`);
  if (rules.manualReviewFromCents !== null && credit.creditCents >= rules.manualReviewFromCents) {
    yellow.push("Der Kreditbetrag liegt über der Grenze für eine automatische Freigabe.");
  }
  const needsBureau = rules.bureauFromCents !== null && credit.creditCents >= rules.bureauFromCents;
  if (needsBureau) yellow.push("Für diesen Betrag ist eine Auskunftei-Abfrage vorgesehen.");
  if (yellow.length) return { result: "gelb", freeIncomeCents: free, reasons: yellow, needsBureau };
  return { result: "gruen", freeIncomeCents: free, reasons: ["Die Monatsrate passt ins freie Einkommen."], needsBureau: false };
}
