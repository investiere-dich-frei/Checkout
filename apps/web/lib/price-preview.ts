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
  const schedule = paymentSchedule(i.plan, i.purchaseDay, limit).map((s) => ({ dueDate: s.dueDate, grossCents: gross(s.amountCents) }));
  const dueNow = schedule.filter((s) => s.dueDate === i.purchaseDay).reduce((t, s) => t + s.grossCents, 0);
  const total = totalCents(i.plan) === null ? null : schedule.reduce((t, s) => t + s.grossCents, 0);
  return {
    rateBp: tax.rateBp,
    note: tax.note,
    dueNowCents: dueNow,
    totalCents: total,
    recurringCents: i.plan.recurringAmountCents === null ? null : gross(i.plan.recurringAmountCents),
    schedule,
  };
}
