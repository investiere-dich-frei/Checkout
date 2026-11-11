/**
 * Rechtstexte für den Ratenkauf (Finanzierungshilfe nach § 506 BGB ab 20.11.2026).
 *
 * ENTWURF vom 11.11.2026, von Claude vorformuliert, von einem Anwalt zu prüfen. Grundlagen:
 *  - Vorvertragliche Information: Europäische Standardinformation für Verbraucherkredite (Anlage 4
 *    zu Art. 247 § 2 EGBGB), Teil „Wesentliche Angaben“. Bei unentgeltlichen Raten mit begrenzten
 *    Verzugskosten beschränkt sie sich auf die Angaben nach Art. 247 § 3 Abs. 1 Satz 1 Nr. 1–11 EGBGB;
 *    dazu Gegenstand und Barzahlungspreis (Art. 247 § 12 Abs. 1 EGBGB).
 *  - Ratenvertrag: Pflichtangaben nach Art. 247 §§ 6, 12 EGBGB, Teilzahlungsgeschäft § 507 BGB.
 *  - Widerrufsinformation: §§ 495, 355, 356b, 357b BGB. Das gesetzliche Muster (Anlage 7) entfällt ab
 *    20.11.2026, daher eigener Text.
 *  - Erinnerung an das Widerrufsrecht: Art. 247 § 2 Abs. 4 EGBGB.
 *
 * Jeder Text trägt CREDIT_TEXTS_VERSION. Eine inhaltliche Änderung braucht eine neue Version; die
 * gerenderten Texte jeder Bestellung liegen unveränderbar in app.credit_documents.
 */

import { CREDIT_WITHDRAWAL_DAYS } from "@idf/core/credit";

export const CREDIT_TEXTS_VERSION = "entwurf-2026-11-11-2";

/** Wortlaut des Pflicht-Kästchens zum Ratenvertrag (nicht vorangekreuzt, § 492 Abs. 1a BGB n. F.). */
export const CREDIT_AGREEMENT_TEXT =
  "Ich schließe mit der Investiere Dich Frei GmbH den Ratenzahlungsvertrag zu den oben genannten Bedingungen. Die Europäische Standardinformation für Verbraucherkredite und die Widerrufsinformation habe ich erhalten.";

/**
 * Wortlaut des freiwilligen Kästchens „Sofortstart mit Wertersatz“ (§ 357b Abs. 2 Satz 3 BGB).
 * Ersetzt bei Ratenkäufen den Sofortstart nach § 356 Abs. 5 BGB, der hier nicht greift (§ 312g Abs. 3 BGB).
 */
export const VALUE_COMPENSATION_TEXT =
  "Ich verlange ausdrücklich, dass die Investiere Dich Frei GmbH vor Ablauf der Widerrufsfrist mit den vertraglichen Leistungen beginnt und mir sofort Zugang zur Lernplattform gewährt. Mir ist bekannt, dass ich bei einem Widerruf Wertersatz für die bis dahin erbrachten Leistungen und bereitgestellten digitalen Inhalte leisten muss.";

/** Hinweis für Werbung und Kaufseite (UWG Anhang Nr. 23e). */
export const CREDIT_WARNING = "Achtung! Kreditaufnahme kostet Geld.";

/** Kontakt zur Schuldnerberatung für Hinweise bei Ablehnung und Zahlungsschwierigkeiten (§§ 497a, 505a BGB n. F.). */
export const DEBT_ADVICE =
  "Kostenlose Hilfe bei Geldsorgen bietet die Schuldnerberatung, z. B. über www.meine-schulden.de (Bundesarbeitsgemeinschaft Schuldnerberatung) oder die Verbraucherzentrale in deinem Bundesland.";

export interface CreditTextData {
  company: { legalName: string; street: string; postalCode: string; city: string; email: string; phone: string | null; registerInfo: string | null };
  customer: { name: string; street: string | null; postalCode: string | null; city: string | null; email: string };
  product: string;
  optionLabel: string;
  currency: string;
  /** Barzahlungspreis (Einmalzahlung) brutto. */
  cashPriceCents: number;
  /** Alle Zahlungen brutto, nach Fälligkeit. */
  schedule: { dueDate: string; grossCents: number }[];
  /** Tag des Vertragsschlusses bzw. des Angebots, YYYY-MM-DD. */
  contractDay: string;
  /** Hinweis zur Umsatzsteuer, z. B. „inkl. 19 % Umsatzsteuer“ oder „umsatzsteuerfrei nach § 4 Nr. 21 UStG“. */
  taxNote: string;
}

const euro = (cents: number, currency: string) => new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
const day = (d: string) => d.split("-").reverse().join(".");

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

function figures(d: CreditTextData) {
  const total = d.schedule.reduce((t, s) => t + s.grossCents, 0);
  const now = d.schedule.filter((s) => s.dueDate === d.contractDay).reduce((t, s) => t + s.grossCents, 0);
  const later = d.schedule.filter((s) => s.dueDate > d.contractDay);
  const last = d.schedule[d.schedule.length - 1]?.dueDate ?? d.contractDay;
  return { total, now, later, credit: total - now, last, months: Math.max(1, monthsBetween(d.contractDay, last)) };
}

function companyBlock(d: CreditTextData): string {
  const c = d.company;
  return [c.legalName, c.street, `${c.postalCode} ${c.city}`, c.phone ? `Telefon: ${c.phone}` : null, `E-Mail: ${c.email}`, c.registerInfo]
    .filter(Boolean)
    .join("\n");
}

function scheduleLines(d: CreditTextData): string[] {
  return d.schedule.map((s, i) => `${i + 1}. ${day(s.dueDate)}: ${euro(s.grossCents, d.currency)}${s.dueDate === d.contractDay ? " (bei Vertragsschluss)" : ""}`);
}

/**
 * Europäische Standardinformation für Verbraucherkredite, Teil „Wesentliche Angaben“ (Anlage 4 EGBGB),
 * beschränkt auf Art. 247 § 3 Abs. 1 Satz 1 Nr. 1–11 EGBGB, plus Gegenstand und Barzahlungspreis.
 */
export function precontractInformation(d: CreditTextData): string {
  const f = figures(d);
  const cur = d.currency;
  return [
    "Europäische Standardinformation für Verbraucherkredite",
    "Wesentliche Angaben",
    `Stand: ${day(d.contractDay)} · Fassung ${CREDIT_TEXTS_VERSION}`,
    "",
    "1. Kreditgeber",
    companyBlock(d),
    "",
    "Art des Kredits: Zahlungsaufschub in Raten (Teilzahlungsgeschäft) für den Kauf der unten genannten Leistung. Der Kredit wird nicht ausgezahlt; der Kaufpreis wird gestundet und in Raten bezahlt.",
    `Gegenstand: ${d.product} – ${d.optionLabel}`,
    `Barzahlungspreis: ${euro(d.cashPriceCents, cur)} (${d.taxNote})`,
    "",
    "2. Nettodarlehensbetrag",
    `${euro(f.credit, cur)} (gestundeter Teil des Kaufpreises nach der Zahlung bei Vertragsschluss von ${euro(f.now, cur)})`,
    "",
    "3. Laufzeit des Kreditvertrags",
    `${f.months} ${f.months === 1 ? "Monat" : "Monate"}, vom ${day(d.contractDay)} bis zur letzten Rate am ${day(f.last)}`,
    "",
    "4. Sollzinssatz",
    "0,00 % pro Jahr, fest für die gesamte Laufzeit",
    "",
    "5. Effektiver Jahreszins",
    "0,00 %. Es fallen keine Zinsen, Gebühren oder sonstigen Kosten für die Ratenzahlung an.",
    "",
    "6. Gesamtbetrag",
    `${euro(f.total, cur)}. Das ist genau der Barzahlungspreis; die Ratenzahlung kostet nichts extra.`,
    "",
    "7. Kosten bei Zahlungsverzug",
    "Bei Zahlungsverzug berechnen wir keine Verzugszinsen und keine Mahngebühren. Auf die gesetzlichen Verzugszinsen (§ 497 Abs. 1, § 288 Abs. 1 BGB) verzichten wir.",
    "",
    "8. Raten",
    `${d.schedule.length} Zahlungen, fällig wie folgt:`,
    ...scheduleLines(d),
    "Jede Zahlung wird mit der beim Kauf hinterlegten Zahlungsart (Karte oder PayPal) am Fälligkeitstag eingezogen. Zahlungen werden auf die jeweils älteste offene Rate angerechnet.",
    "",
    "9. Warnhinweis zu ausbleibenden Zahlungen",
    "Wenn Zahlungen ausbleiben oder verspätet sind, kann das schwerwiegende Folgen haben: Die Forderung kann einem Inkassounternehmen übergeben oder gerichtlich geltend gemacht werden, und es kann künftig schwieriger werden, einen Kredit zu bekommen. Sind mindestens zwei aufeinanderfolgende Raten ganz oder teilweise und mindestens 10 % des Gesamtbetrags (bei einer Laufzeit über drei Jahre 5 %) rückständig, dürfen wir nach einer Frist von zwei Wochen mit Kündigungsandrohung den gesamten Restbetrag fällig stellen (§ 498 BGB).",
    "",
    "10. Widerrufsrecht",
    `Ja. Du kannst den Ratenzahlungsvertrag innerhalb von ${CREDIT_WITHDRAWAL_DAYS} Tagen ohne Angabe von Gründen widerrufen. Einzelheiten stehen in der Widerrufsinformation.`,
    "",
    "11. Vorzeitige Rückzahlung",
    "Du kannst den offenen Betrag jederzeit ganz oder teilweise vorzeitig bezahlen. Dafür fallen keine Kosten und keine Vorfälligkeitsentschädigung an.",
    "",
    `Diese Informationen erhältst du vor Vertragsschluss per E-Mail (dauerhafter Datenträger). Auf Wunsch senden wir sie dir auch auf Papier.`,
  ].join("\n");
}

/** Widerrufsinformation für den Ratenzahlungsvertrag (Finanzierungshilfe, Fernabsatz, digitale Inhalte/Dienstleistungen). */
export function creditWithdrawalInformation(d: Pick<CreditTextData, "company">): string {
  const c = d.company;
  return [
    `Widerrufsinformation für den Ratenzahlungsvertrag (Fassung ${CREDIT_TEXTS_VERSION})`,
    "",
    "Widerrufsrecht",
    `Du kannst deine Vertragserklärung innerhalb von ${CREDIT_WITHDRAWAL_DAYS} Tagen ohne Angabe von Gründen widerrufen. Die Frist beginnt nach Abschluss des Vertrags, aber erst, nachdem du alle Pflichtangaben nach § 492 Abs. 2 BGB (z. B. Angaben zur Art des Kredits, zum Nettodarlehensbetrag und zur Laufzeit) erhalten hast. Du hast alle Pflichtangaben erhalten, wenn sie in dem Vertragstext enthalten sind, den wir dir per E-Mail zusenden. Werden Pflichtangaben nachträglich auf einem dauerhaften Datenträger mitgeteilt, beträgt die Widerrufsfrist einen Monat.`,
    "Das Widerrufsrecht erlischt spätestens zwölf Monate und 14 Tage nach Vertragsschluss.",
    "Zur Wahrung der Frist genügt die rechtzeitige Absendung des Widerrufs, wenn er auf einem dauerhaften Datenträger erfolgt (z. B. Brief oder E-Mail). Du kannst auch den Link „Vertrag widerrufen“ auf unseren Seiten nutzen. Der Widerruf ist zu richten an:",
    [c.legalName, c.street, `${c.postalCode} ${c.city}`, `E-Mail: ${c.email}`].join(", "),
    "",
    "Widerrufsfolgen",
    "Der Ratenzahlungsvertrag ist zugleich der Kaufvertrag über die Leistung. Mit einem wirksamen Widerruf bist du an den gesamten Vertrag nicht mehr gebunden; offene Raten entfallen.",
    "Bereits empfangene Leistungen sind spätestens nach 30 Tagen zurückzugewähren. Die Frist beginnt für dich mit der Absendung des Widerrufs, für uns mit dessen Empfang. Bereits gezahlte Raten erstatten wir dir innerhalb dieser Frist über die Zahlungsart, mit der du bezahlt hast, abzüglich eines etwaigen Wertersatzes.",
    "Hast du verlangt, dass wir vor Ablauf der Widerrufsfrist mit den Leistungen beginnen und dir Zugang zur Lernplattform geben, und wurdest du vorher darauf hingewiesen, schuldest du Wertersatz für die bis zum Widerruf erbrachten Leistungen und bereitgestellten digitalen Inhalte. Grundlage ist der vereinbarte Preis, anteilig für die Zeit vom Beginn des Zugangs bis zum Widerruf, gemessen an der vereinbarten Gesamtdauer des Zugangs. Ist der Preis unverhältnismäßig hoch, ist der Marktwert der erbrachten Leistung maßgeblich (§ 357b Abs. 2 BGB).",
    "Mit dem Widerruf endet dein Zugang zur Lernplattform.",
    "",
    "Besondere Hinweise",
    "Ein Widerrufsrecht nach den Vorschriften über Fernabsatzverträge (§ 312g BGB) besteht daneben nicht, weil dir dieses Widerrufsrecht für den Ratenzahlungsvertrag zusteht (§ 312g Abs. 3 BGB).",
    "",
    "Ende der Widerrufsinformation",
  ].join("\n");
}

/** Ratenzahlungsvertrag mit den Pflichtangaben (Art. 247 §§ 6, 12 EGBGB), als Textform per E-Mail. */
export function creditContract(d: CreditTextData, extra: { orderNumber: string; valueCompensation: boolean }): string {
  const f = figures(d);
  const cur = d.currency;
  return [
    `Ratenzahlungsvertrag (Teilzahlungsgeschäft) Nr. ${extra.orderNumber} vom ${day(d.contractDay)}`,
    `Fassung ${CREDIT_TEXTS_VERSION}`,
    "",
    "Vertragsparteien",
    `Kreditgeber und Verkäufer: ${companyBlock(d).split("\n").join(", ")}`,
    `Kundin/Kunde: ${[d.customer.name, d.customer.street, [d.customer.postalCode, d.customer.city].filter(Boolean).join(" "), d.customer.email].filter(Boolean).join(", ")}`,
    "",
    "1. Gegenstand und Art des Kredits",
    `Kauf von „${d.product} – ${d.optionLabel}“ mit Zahlungsaufschub in Raten (Teilzahlungsgeschäft, § 506 Abs. 1, § 507 BGB). Es wird kein Geld ausgezahlt.`,
    "",
    "2. Preise",
    `Barzahlungspreis: ${euro(d.cashPriceCents, cur)} (${d.taxNote})`,
    `Teilzahlungspreis (Gesamtbetrag aller Raten): ${euro(f.total, cur)}`,
    `Nettodarlehensbetrag: ${euro(f.credit, cur)}`,
    "Sollzinssatz: 0,00 % pro Jahr, fest · Effektiver Jahreszins: 0,00 %",
    "Sonstige Kosten der Ratenzahlung: keine",
    "",
    "3. Laufzeit und Raten",
    `Laufzeit: ${day(d.contractDay)} bis ${day(f.last)} (${f.months} ${f.months === 1 ? "Monat" : "Monate"})`,
    ...scheduleLines(d),
    "Die Raten werden am Fälligkeitstag mit der hinterlegten Zahlungsart eingezogen. Zahlungen werden auf die älteste offene Rate angerechnet. Du kannst jederzeit kostenlos vorzeitig zahlen.",
    "",
    "4. Verzug",
    "Bei Verzug berechnen wir keine Verzugszinsen und keine Mahngebühren; auf die gesetzlichen Verzugszinsen (§ 497 Abs. 1 BGB) verzichten wir. Den Restbetrag dürfen wir nur unter den Voraussetzungen des § 498 BGB fällig stellen (mindestens zwei aufeinanderfolgende Raten und mindestens 10 % des Gesamtbetrags rückständig, zweiwöchige Frist mit Androhung). Bei Zahlungsschwierigkeiten sprich uns bitte an; wir suchen gemeinsam eine Lösung (z. B. Zahlpause oder Stundung). " +
      DEBT_ADVICE,
    "",
    "5. Sicherheiten",
    "Wir verlangen keine Sicherheiten.",
    "",
    "6. Kündigung",
    "Der Vertrag endet mit Zahlung der letzten Rate. Eine Kündigung durch uns ist nur nach § 498 BGB möglich.",
    "",
    "7. Erklärungen",
    "Erklärungen zum Vertrag (z. B. Widerruf) kannst du per E-Mail oder Brief an die oben genannte Anschrift oder über den Link „Vertrag widerrufen“ abgeben.",
    "",
    "8. Leistungsbeginn",
    extra.valueCompensation
      ? `Du hast verlangt, sofort Zugang zu bekommen: „${VALUE_COMPENSATION_TEXT}“`
      : `Du hast keinen sofortigen Start verlangt. Dein Zugang beginnt am Tag nach Ablauf der Widerrufsfrist.`,
    "",
    "9. Beschwerden und Aufsicht",
    `Beschwerden richte bitte an ${d.company.email}. [ENTWURF: Angaben zu Streitbeilegung, Aufsichtsbehörde und § 4 Abs. 2 AbsFinAG vom Anwalt prüfen lassen.]`,
    "",
    "10. Weitere Bedingungen",
    "Im Übrigen gelten unsere Allgemeinen Geschäftsbedingungen in der beim Kauf zugestimmten Fassung.",
    "",
    creditWithdrawalInformation(d),
  ].join("\n");
}

/** Erinnerung an das Widerrufsrecht, 1 bis 7 Tage nach Vertragsschluss (Art. 247 § 2 Abs. 4 EGBGB). */
export function creditWithdrawalReminder(d: Pick<CreditTextData, "company" | "product" | "contractDay">, withdrawalEnd: string): string {
  return [
    `zur Erinnerung: Du hast am ${day(d.contractDay)} „${d.product}“ in Raten gekauft. Du kannst diesen Ratenzahlungsvertrag noch bis einschließlich ${day(withdrawalEnd)} ohne Angabe von Gründen widerrufen.`,
    "",
    "Dafür genügt eine E-Mail an " + d.company.email + " oder der Link „Vertrag widerrufen“ auf unseren Seiten. Die vollständige Widerrufsinformation steht in deinem Ratenzahlungsvertrag, den wir dir nach dem Kauf geschickt haben.",
  ].join("\n");
}
