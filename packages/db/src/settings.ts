import { EU_STANDARD_RATES_BP } from "@idf/core/tax";
import type pg from "pg";

/**
 * Einstellungen in der Verwaltung: Firmendaten, Steuersatz Schweiz, Rechtstexte.
 *
 * GoBD: Ausgestellte Rechnungen tragen eine Kopie der Firmendaten (company_snapshot) und ändern sich
 * nie. Änderungen hier gelten nur für neue Rechnungen und stehen im Audit-Log. Rechtstexte werden nie
 * überschrieben, sondern bekommen eine neue Fassung mit Gültigkeitsbeginn; jede Bestellung verweist auf
 * die Fassung, die beim Kauf galt. Nummernkreis und Zahlungsmodus (Test/Live) sind hier bewusst nicht
 * änderbar.
 */

type Db = pg.Pool | pg.ClientBase;

export class SettingsError extends Error {}

export interface CompanySettings {
  id: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId: string | null;
  taxNumber: string | null;
  registerInfo: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  chVatRateBp: number | null;
  paymentsMode: string;
  invoicePrefix: string | null;
  invoiceNextValue: number | null;
}

export async function listCompanySettings(db: Db): Promise<CompanySettings[]> {
  const { rows } = await db.query(
    `select c.*, s.prefix, s.next_value from app.companies c left join app.invoice_number_series s on s.company_id = c.id order by c.legal_name`,
  );
  return rows.map((r) => ({
    id: r.id,
    legalName: r.legal_name,
    street: r.street,
    postalCode: r.postal_code,
    city: r.city,
    country: r.country,
    vatId: r.vat_id,
    taxNumber: r.tax_number,
    registerInfo: r.register_info,
    bankName: r.bank_name,
    iban: r.iban,
    bic: r.bic,
    chVatRateBp: r.ch_vat_rate_bp,
    paymentsMode: r.payments_mode,
    invoicePrefix: r.prefix ?? null,
    invoiceNextValue: r.next_value === null || r.next_value === undefined ? null : Number(r.next_value),
  }));
}

export interface CompanyUpdate {
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId: string;
  taxNumber: string;
  registerInfo: string;
  bankName: string;
  iban: string;
  bic: string;
  /** Prozent wie „8,1“; leer = kein Satz (Verkauf in die Schweiz dann nicht möglich). */
  chVatRate: string;
}

/** „8,1“ oder „8.1“ in Basispunkten (810). */
export function parsePercentBp(value: string): number | null {
  const v = value.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!v) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) throw new SettingsError("Steuersatz bitte als Zahl angeben, z. B. 8,1.");
  const bp = Math.round(Number(v) * 100);
  if (bp < 1 || bp > 10000) throw new SettingsError("Steuersatz muss zwischen 0,01 und 100 % liegen.");
  return bp;
}

const opt = (v: string) => (v.trim() ? v.trim() : null);

/** Firmendaten ändern. Gilt für neue Rechnungen; ausgestellte bleiben, wie sie sind. */
export async function updateCompanySettings(client: pg.ClientBase, companyId: string, u: CompanyUpdate): Promise<void> {
  for (const [key, label] of [
    ["legalName", "Firmenname"],
    ["street", "Straße"],
    ["postalCode", "PLZ"],
    ["city", "Ort"],
  ] as const) {
    if (!u[key].trim()) throw new SettingsError(`${label} fehlt.`);
  }
  const country = u.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new SettingsError("Land bitte als Kürzel angeben, z. B. DE.");
  const iban = u.iban.replace(/\s+/g, "").toUpperCase() || null;
  if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) throw new SettingsError("Die IBAN ist ungültig.");
  if (iban && !ibanChecksumOk(iban)) throw new SettingsError("Die IBAN hat eine falsche Prüfziffer.");
  const bic = u.bic.replace(/\s+/g, "").toUpperCase() || null;
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) throw new SettingsError("Die BIC ist ungültig.");
  const vatId = u.vatId.replace(/\s+/g, "").toUpperCase() || null;
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId)) throw new SettingsError("Die USt-IdNr. ist ungültig.");
  const ch = parsePercentBp(u.chVatRate);
  const r = await client.query(
    `update app.companies set legal_name = $2, street = $3, postal_code = $4, city = $5, country = $6, vat_id = $7,
            tax_number = $8, register_info = $9, bank_name = $10, iban = $11, bic = $12, ch_vat_rate_bp = $13
      where id = $1`,
    [companyId, u.legalName.trim(), u.street.trim(), u.postalCode.trim(), u.city.trim(), country, vatId, opt(u.taxNumber), opt(u.registerInfo), opt(u.bankName), iban, bic, ch],
  );
  if (!r.rowCount) throw new SettingsError("Die Gesellschaft gibt es nicht.");
}

export function ibanChecksumOk(iban: string): boolean {
  const s = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of s) {
    const n = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Feste Sätze aus dem Code (gesetzlich), zur Anzeige. */
export function statutoryRates(): { country: string; rateBp: number }[] {
  return ["DE", "AT"].map((c) => ({ country: c, rateBp: EU_STANDARD_RATES_BP[c]! }));
}

export type LegalKind = "agb" | "datenschutz" | "widerruf";
export const LEGAL_KINDS: LegalKind[] = ["agb", "datenschutz", "widerruf"];

export interface LegalVersion {
  id: string;
  kind: LegalKind;
  version: string;
  validFrom: Date;
  createdAt: Date;
  chars: number;
  orders: number;
  state: "gilt" | "geplant" | "abgeloest";
}

/** Alle Fassungen der Rechtstexte, neueste zuerst, mit Lage und Zahl der Bestellungen. */
export async function legalVersions(db: Db): Promise<LegalVersion[]> {
  const { rows } = await db.query(
    `select v.id, v.kind, v.version, v.valid_from, v.created_at, length(v.content) chars,
            (select count(*)::int from app.orders o where o.agb_version_id = v.id or o.privacy_version_id = v.id or o.withdrawal_version_id = v.id) orders,
            v.valid_from > now() planned,
            v.id = (select w.id from app.legal_text_versions w where w.kind = v.kind and w.valid_from <= now() order by w.valid_from desc limit 1) current
       from app.legal_text_versions v order by v.kind, v.valid_from desc`,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    version: r.version,
    validFrom: r.valid_from,
    createdAt: r.created_at,
    chars: Number(r.chars),
    orders: r.orders,
    state: r.planned ? "geplant" : r.current ? "gilt" : "abgeloest",
  }));
}

export async function legalVersionContent(db: Db, id: string): Promise<{ kind: string; version: string; content: string } | null> {
  const { rows } = await db.query(`select kind, version, content from app.legal_text_versions where id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Neue Fassung eines Rechtstextes ab einem Tag (00:00 Uhr Berliner Zeit, frühestens heute = sofort).
 * Alte Fassungen bleiben unverändert und gelten für die Bestellungen, die mit ihnen geschlossen wurden.
 */
export async function addLegalVersion(
  client: pg.ClientBase,
  input: { kind: string; version: string; content: string; validFromDay: string; today: string },
): Promise<string> {
  if (!LEGAL_KINDS.includes(input.kind as LegalKind)) throw new SettingsError("Unbekannte Art von Rechtstext.");
  const version = input.version.trim();
  if (!version) throw new SettingsError("Bitte eine Bezeichnung der Fassung angeben, z. B. das Datum vom Anwalt.");
  const content = input.content.replace(/\r\n/g, "\n").trim();
  if (content.length < 200) throw new SettingsError("Der Text ist zu kurz. Bitte den vollständigen Wortlaut einfügen.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFromDay)) throw new SettingsError("Bitte ein gültiges Datum angeben.");
  if (input.validFromDay < input.today) throw new SettingsError("Eine neue Fassung kann frühestens heute gelten.");
  const dup = await client.query(`select 1 from app.legal_text_versions where kind = $1 and version = $2`, [input.kind, version]);
  if (dup.rowCount) throw new SettingsError("Diese Fassung gibt es schon. Bitte eine neue Bezeichnung wählen.");
  const same = await client.query(
    `select 1 from app.legal_text_versions where kind = $1 and content_sha256 = sha256(convert_to($2, 'UTF8'))
        and id = (select id from app.legal_text_versions where kind = $1 and valid_from <= now() order by valid_from desc limit 1)`,
    [input.kind, content],
  );
  if (same.rowCount) throw new SettingsError("Der Text ist identisch mit der geltenden Fassung.");
  // Heute = ab sofort (nicht rückwirkend auf heute 00:00, damit keine Bestellung nachträglich eine andere Fassung bekommt).
  const { rows } = await client.query<{ id: string }>(
    `insert into app.legal_text_versions (kind, version, content, valid_from)
     values ($1, $2, $3, case when $4::date <= $5::date then now() else ($4::date::timestamp at time zone 'Europe/Berlin') end) returning id`,
    [input.kind, version, content, input.validFromDay, input.today],
  );
  return rows[0]!.id;
}
