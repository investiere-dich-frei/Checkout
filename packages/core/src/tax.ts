/**
 * Umsatzsteuer je Rechnungsposition.
 *
 * Die Regeln sind versioniert (TAX_RULES_VERSION). Jede Rechnung speichert
 * Satz, Hinweistext und Regel-ID als Wert, damit eine spätere Änderung der
 * Regeln alte Belege nicht berührt und sie erklärbar bleiben.
 *
 * Stand der Regeln: 29.10.2026, vor dem Go-live von der Steuerberatung zu bestätigen.
 */

export const TAX_RULES_VERSION = "2026-10-29";

export type TaxCategory = "standard" | "steuerfrei_4_21";

/** Normalsätze der EU-Staaten in Basispunkten (1900 = 19 %). */
export const EU_STANDARD_RATES_BP: Readonly<Record<string, number>> = {
  AT: 2000, BE: 2100, BG: 2000, CY: 1900, CZ: 2100, DE: 1900, DK: 2500, EE: 2400,
  ES: 2100, FI: 2550, FR: 2000, GR: 2400, HR: 2500, HU: 2700, IE: 2300, IT: 2200,
  LT: 2100, LU: 1700, LV: 2100, MT: 1800, NL: 2100, PL: 2300, PT: 2300, RO: 2100,
  SE: 2500, SI: 2200, SK: 2300,
};

export const NOTE_EXEMPT_4_21 = "Die Leistung ist umsatzsteuerfrei nach § 4 Nr. 21 a) bb) UStG.";
export const NOTE_REVERSE_CHARGE = "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).";
export const NOTE_NOT_TAXABLE = "Nicht im Inland steuerbare Leistung.";

export interface Buyer {
  /** ISO-3166-Ländercode, z. B. DE, AT, CH. */
  country: string;
  isBusiness: boolean;
  /** USt-IdNr. per VIES geprüft und gültig. */
  vatIdVerified: boolean;
}

export interface TaxSettings {
  /** Schweizer MWST-Satz, falls die Gesellschaft in der Schweiz registriert ist; sonst null. */
  chVatRateBp: number | null;
}

export interface TaxDecision {
  rateBp: number;
  /** Pflichtangabe auf der Rechnung, wenn keine Steuer anfällt. */
  note: string | null;
  /** Welche Regel gegriffen hat, für den Nachweis. */
  rule: "de_exempt_4_21" | "de_standard" | "eu_reverse_charge" | "eu_oss" | "ch_mwst" | "non_eu";
  rulesVersion: string;
}

function decision(rateBp: number, note: string | null, rule: TaxDecision["rule"]): TaxDecision {
  return { rateBp, note, rule, rulesVersion: TAX_RULES_VERSION };
}

export function decideTax(category: TaxCategory, buyer: Buyer, settings: TaxSettings): TaxDecision {
  const country = buyer.country.toUpperCase();

  if (country === "DE") {
    return category === "steuerfrei_4_21"
      ? decision(0, NOTE_EXEMPT_4_21, "de_exempt_4_21")
      : decision(1900, null, "de_standard");
  }

  const euRate = EU_STANDARD_RATES_BP[country];
  if (euRate !== undefined) {
    // Die Befreiung nach § 4 Nr. 21 gilt nur, wo die Leistung in Deutschland steuerbar ist.
    // Bei Verbrauchern im EU-Ausland gilt der Satz ihres Landes (OSS).
    if (buyer.isBusiness && buyer.vatIdVerified) {
      return decision(0, NOTE_REVERSE_CHARGE, "eu_reverse_charge");
    }
    return decision(euRate, null, "eu_oss");
  }

  if (country === "CH" && settings.chVatRateBp !== null) {
    return decision(settings.chVatRateBp, null, "ch_mwst");
  }
  return decision(0, NOTE_NOT_TAXABLE, "non_eu");
}
