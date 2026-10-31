import { applyDiscount, discountedPlan, type Discount } from "@idf/core/discount";
import { paymentSchedule, splitAmount, totalCents, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import { decideTax, type TaxCategory } from "@idf/core/tax";

export interface PreviewInput {
  plan: PricePlan;
  amountBasis: AmountBasis;
  taxCategory: TaxCategory;
  chVatRateBp: number | null;
  country: string;
  isBusiness: boolean;
  purchaseDay: string;
  /** Eingelöster Gutschein, falls vorhanden. */
  discount?: Discount | null;
}

export interface Preview {
  rateBp: number;
  note: string | null;
  /** Heute fällig, brutto. */
  dueNowCents: number;
  /** Alle Zahlungen zusammen, brutto; null bei Abos ohne Ende. */
  totalCents: number | null;
  /** Folgezahlung brutto, falls es welche gibt. */
  recurringCents: number | null;
  schedule: { dueDate: string; grossCents: number }[];
  /** Ersparnis brutto über alle Zahlungen; bei Abos nur die der ersten Zahlung. */
  savingsCents: number;
  /** Ersparnis je Folgezahlung brutto (nur bei Gutscheinen für alle Zahlungen). */
  recurringSavingsCents: number;
}

/**
 * Preisanzeige im Checkout. Dieselben Funktionen wie bei der Bestellung, damit
 * angezeigter und berechneter Preis nicht auseinanderlaufen. Reverse Charge zeigt
 * die Vorschau nie an: Die USt-IdNr. ist hier noch nicht geprüft.
 */
export function previewPrice(i: PreviewInput): Preview {
  const tax = decideTax(i.taxCategory, { country: i.country, isBusiness: i.isBusiness, vatIdVerified: false }, { chVatRateBp: i.chVatRateBp });
  const gross = (cents: number) => splitAmount(cents, i.amountBasis, tax.rateBp).grossCents;
  const limit = i.plan.kind === "abo" ? 3 : Number.MAX_SAFE_INTEGER;
  const list = paymentSchedule(i.plan, i.purchaseDay, limit);
  // Gleiche Rechnung wie bei der Bestellung (orders.ts): erst Rabatt, dann Steuer.
  const discounted = i.discount ? applyDiscount(list, i.discount) : list.map((s) => ({ ...s, listAmountCents: s.amountCents }));
  const schedule = discounted.map((s) => ({ dueDate: s.dueDate, grossCents: gross(s.amountCents) }));
  // Abos laufen ohne Ende: dort zählt die Ersparnis der ersten Zahlung, die Folgezahlungen stehen extra.
  const savings = (i.plan.kind === "abo" ? discounted.slice(0, 1) : discounted).reduce((t, s) => t + gross(s.listAmountCents) - gross(s.amountCents), 0);
  const recurringPlan = i.discount ? discountedPlan(i.plan, i.discount) : i.plan;
  const recurring = recurringPlan.recurringAmountCents === null ? null : gross(recurringPlan.recurringAmountCents);
  const dueNow = schedule.filter((s) => s.dueDate === i.purchaseDay).reduce((t, s) => t + s.grossCents, 0);
  const total = totalCents(i.plan) === null ? null : schedule.reduce((t, s) => t + s.grossCents, 0);
  return {
    rateBp: tax.rateBp,
    note: tax.note,
    dueNowCents: dueNow,
    totalCents: total,
    recurringCents: recurring,
    schedule,
    savingsCents: savings,
    recurringSavingsCents:
      i.plan.recurringAmountCents === null || recurring === null ? 0 : gross(i.plan.recurringAmountCents) - recurring,
  };
}
