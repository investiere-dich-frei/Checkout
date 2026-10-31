import type { AmountBasis, PriceKind } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
export { slugFromName } from "./slug";
import { ProductError, type PriceOptionInput, type ProductInput } from "@idf/db/products";

/**
 * Liest Euro-Beträge, wie man sie tippt: „37“, „37,50“, „1.234,56“, „1234.56“, „37 €“.
 * Ergebnis in Cent, ohne Gleitkomma-Rundung. Leer = null.
 */
export function parseEuro(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "")
    .replace(/€|eur/gi, "")
    .replace(/\s/g, "");
  if (!s) return null;
  let m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (m) return Number(m[1]!.replace(/\./g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  // Englische Schreibweise nur mit Dezimalpunkt, sonst wäre „1,497“ mehrdeutig.
  m = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  throw new ProductError(`„${String(raw)}“ ist kein gültiger Betrag. Beispiel: 1.234,50`);
}

function parseCount(raw: FormDataEntryValue | null, what: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) throw new ProductError(`Bitte bei „${what}“ eine ganze Zahl eintragen.`);
  return Number(s);
}

/** Cent als Euro-Text für Formularfelder, z. B. 123450 → „1234,50“. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(euros) : `${euros},${String(rest).padStart(2, "0")}`;
}

export function productFromForm(form: FormData): ProductInput {
  return {
    name: String(form.get("name") ?? ""),
    slug: String(form.get("slug") ?? ""),
    internalLabel: String(form.get("internal_label") ?? "") || null,
    taxCategory: String(form.get("tax_category") ?? "") as TaxCategory,
    immediateAccess: form.get("immediate_access") === "on",
  };
}

export function priceOptionFromForm(form: FormData): PriceOptionInput {
  const kind = String(form.get("kind") ?? "") as PriceKind;
  const once = kind === "einmal";
  return {
    label: String(form.get("label") ?? ""),
    kind,
    amountBasis: String(form.get("amount_basis") ?? "") as AmountBasis,
    amountCents: parseEuro(form.get("amount")) ?? (kind === "einmal" ? -1 : 0),
    recurringAmountCents: once ? null : parseEuro(form.get("recurring_amount")),
    recurringCount: once || kind === "abo" ? null : parseCount(form.get("recurring_count"), "Anzahl der Folgezahlungen"),
    intervalMonths: once ? null : parseCount(form.get("interval_months"), "Abstand in Monaten"),
    trialDays: once ? null : parseCount(form.get("trial_days"), "Probezeit in Tagen"),
  };
}

export const KIND_LABEL: Record<PriceKind, string> = {
  einmal: "Einmalzahlung",
  raten: "Raten",
  anzahlung: "Anzahlung + Raten",
  abo: "Abo",
};

export const TAX_LABEL: Record<TaxCategory, string> = {
  standard: "Mit Umsatzsteuer",
  steuerfrei_4_21: "Steuerfrei nach § 4 Nr. 21 UStG",
};

export const BASIS_LABEL: Record<AmountBasis, string> = {
  brutto: "brutto (Steuer ist im Preis enthalten)",
  netto: "netto (Steuer kommt dazu)",
};
