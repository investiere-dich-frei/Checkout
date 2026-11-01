import { crc32 } from "node:zlib";
import type pg from "pg";
import { canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

/**
 * Buchhaltung: Rechnungsliste als CSV, Steuerbericht je Land und Satz (auch für die OSS-Meldung),
 * Rechnungs-PDFs als ZIP. Alles nur lesend und nur für Admin und Prüfung (Steuerberatung).
 * Grundlage sind die ausgestellten Rechnungen mit ihrem Stand bei Ausstellung (Schnappschuss).
 * Stornorechnungen stehen mit negativen Beträgen im Zeitraum ihrer Ausstellung.
 */

type Db = pg.Pool | pg.ClientBase;

export class AccountingError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface Period {
  /** Erster Tag, einschließlich (YYYY-MM-DD). */
  from: string;
  /** Letzter Tag, einschließlich. */
  to: string;
}

export function checkPeriod(p: Period): Period {
  if (!DAY.test(p.from) || !DAY.test(p.to)) throw new AccountingError("Bitte Zeitraum als Datum angeben.");
  if (p.from > p.to) throw new AccountingError("Der Zeitraum endet vor seinem Beginn.");
  return p;
}

/** EU-Länder (ohne DE): Umsatzsteuer dorthin an Privatkundinnen gehört in die OSS-Meldung. */
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export interface InvoiceLine {
  invoiceNumber: string;
  kind: string;
  correctsNumber: string | null;
  issueDate: string;
  serviceFrom: string;
  serviceTo: string;
  company: string;
  customer: string;
  customerKind: string;
  country: string;
  vatId: string | null;
  description: string;
  taxRateBp: number;
  taxNote: string | null;
  netCents: number;
  taxCents: number;
  grossCents: number;
  currency: string;
  paymentProvider: string | null;
  paymentRef: string | null;
  orderId: string;
}

/** Eine Zeile je Rechnungsposition, nach Rechnungsnummer. */
export async function invoiceLines(db: Db, user: SessionUser, period: Period): Promise<InvoiceLine[]> {
  if (!canSeeAll(user)) throw new AccountingError("Keine Berechtigung");
  checkPeriod(period);
  const { rows } = await db.query(
    `select i.invoice_number, i.kind, c.invoice_number corrects_number, i.issue_date::text, i.service_date_from::text, i.service_date_to::text,
            i.company_snapshot->>'legal_name' company,
            coalesce(nullif(i.customer_snapshot->>'company_name', ''),
                     nullif(concat_ws(' ', i.customer_snapshot->>'first_name', i.customer_snapshot->>'last_name'), ''),
                     i.customer_snapshot->>'email') customer,
            i.customer_snapshot->>'kind' customer_kind, upper(i.customer_snapshot->>'country') country,
            nullif(i.customer_snapshot->>'vat_id', '') vat_id,
            it.description, it.tax_rate_bp, it.tax_exemption_note, it.net_cents, it.tax_cents, it.gross_cents, i.currency,
            pay.provider, pay.provider_ref, i.order_id
       from app.invoices i
       join app.invoice_items it on it.invoice_id = i.id
       left join app.invoices c on c.id = i.corrects_invoice_id
       left join lateral (
         select p.provider, p.provider_ref from app.order_installments x join app.payments p on p.id = x.payment_id
          where x.invoice_id = coalesce(i.corrects_invoice_id, i.id) limit 1) pay on true
      where i.issue_date between $1::date and $2::date
      order by i.company_id, i.number_seq, it.position`,
    [period.from, period.to],
  );
  return rows.map((r) => ({
    invoiceNumber: r.invoice_number,
    kind: r.kind,
    correctsNumber: r.corrects_number,
    issueDate: r.issue_date,
    serviceFrom: r.service_date_from,
    serviceTo: r.service_date_to,
    company: r.company,
    customer: r.customer,
    customerKind: r.customer_kind,
    country: r.country,
    vatId: r.vat_id,
    description: r.description,
    taxRateBp: r.tax_rate_bp,
    taxNote: r.tax_exemption_note,
    netCents: Number(r.net_cents),
    taxCents: Number(r.tax_cents),
    grossCents: Number(r.gross_cents),
    currency: r.currency,
    paymentProvider: r.provider,
    paymentRef: r.provider_ref,
    orderId: r.order_id,
  }));
}

export interface TaxReportRow {
  country: string;
  taxRateBp: number;
  /** Steuerfrei bzw. Reverse Charge: Hinweis auf der Rechnung. */
  taxNote: string | null;
  business: boolean;
  currency: string;
  /** In die OSS-Meldung (EU-Ausland, Privatkundin, mit Umsatzsteuer). */
  oss: boolean;
  invoices: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Summen je Land, Steuersatz, Hinweis und Kundenart im Zeitraum (Ausstellungsdatum). */
export async function taxReport(db: Db, user: SessionUser, period: Period): Promise<TaxReportRow[]> {
  const lines = await invoiceLines(db, user, period);
  const map = new Map<string, TaxReportRow & { numbers: Set<string> }>();
  for (const l of lines) {
    const business = l.customerKind === "unternehmen";
    const key = [l.country, l.taxRateBp, l.taxNote ?? "", business, l.currency].join("|");
    let r = map.get(key);
    if (!r) {
      r = {
        country: l.country,
        taxRateBp: l.taxRateBp,
        taxNote: l.taxNote,
        business,
        currency: l.currency,
        oss: EU_COUNTRIES.has(l.country) && !business && l.taxRateBp > 0,
        invoices: 0,
        netCents: 0,
        taxCents: 0,
        grossCents: 0,
        numbers: new Set(),
      };
      map.set(key, r);
    }
    r.numbers.add(l.invoiceNumber);
    r.netCents += l.netCents;
    r.taxCents += l.taxCents;
    r.grossCents += l.grossCents;
  }
  return [...map.values()]
    .map(({ numbers, ...r }) => ({ ...r, invoices: numbers.size }))
    .sort((a, b) => (a.country === b.country ? b.taxRateBp - a.taxRateBp : a.country === "DE" ? -1 : b.country === "DE" ? 1 : a.country.localeCompare(b.country)));
}

// ---------------------------------------------------------------------------
// CSV (für Excel und DATEV-Import: Semikolon, Dezimalkomma, UTF-8 mit BOM)
// ---------------------------------------------------------------------------

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const rate = (bp: number) => (bp / 100).toFixed(bp % 100 === 0 ? 0 : 2).replace(".", ",");
const day = (d: string) => d.split("-").reverse().join(".");

function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Formeln nicht ausführen lassen (CSV-Injection) und Trennzeichen schützen.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

const KIND: Record<string, string> = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Korrektur" };

export function invoiceLinesCsv(lines: InvoiceLine[]): string {
  return toCsv(
    [
      "Rechnungsnummer", "Art", "Bezug", "Rechnungsdatum", "Leistung von", "Leistung bis", "Gesellschaft", "Kundin", "Kundenart", "Land", "USt-IdNr.",
      "Position", "Steuersatz %", "Steuerhinweis", "Netto", "USt", "Brutto", "Währung", "Zahlungsart", "Zahlungsreferenz", "Bestellung",
    ],
    lines.map((l) => [
      l.invoiceNumber, KIND[l.kind] ?? l.kind, l.correctsNumber, day(l.issueDate), day(l.serviceFrom), day(l.serviceTo), l.company, l.customer,
      l.customerKind === "unternehmen" ? "Unternehmen" : "Privat", l.country, l.vatId, l.description, rate(l.taxRateBp), l.taxNote,
      money(l.netCents), money(l.taxCents), money(l.grossCents), l.currency, l.paymentProvider, l.paymentRef, l.orderId,
    ]),
  );
}

export function taxReportCsv(rows: TaxReportRow[]): string {
  return toCsv(
    ["Land", "Steuersatz %", "Steuerhinweis", "Kundenart", "OSS", "Rechnungen", "Netto", "USt", "Brutto", "Währung"],
    rows.map((r) => [
      r.country, rate(r.taxRateBp), r.taxNote, r.business ? "Unternehmen" : "Privat", r.oss ? "ja" : "nein", r.invoices,
      money(r.netCents), money(r.taxCents), money(r.grossCents), r.currency,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Rechnungs-PDFs als ZIP (ungepackt gespeichert: PDFs sind schon komprimiert)
// ---------------------------------------------------------------------------

/** Höchstens so viele PDFs je ZIP, damit der Download handlich bleibt. */
export const MAX_ZIP_FILES = 2000;

export async function invoicePdfs(db: Db, user: SessionUser, period: Period): Promise<{ name: string; data: Buffer; date: string }[]> {
  if (!canSeeAll(user)) throw new AccountingError("Keine Berechtigung");
  checkPeriod(period);
  const { rows } = await db.query<{ invoice_number: string; kind: string; issue_date: string; pdf: Buffer }>(
    `select i.invoice_number, i.kind, i.issue_date::text, d.pdf
       from app.invoices i join app.invoice_documents d on d.invoice_id = i.id
      where i.issue_date between $1::date and $2::date
      order by i.company_id, i.number_seq
      limit $3`,
    [period.from, period.to, MAX_ZIP_FILES + 1],
  );
  if (rows.length > MAX_ZIP_FILES) throw new AccountingError(`Mehr als ${MAX_ZIP_FILES} Rechnungen im Zeitraum. Bitte kürzeren Zeitraum wählen.`);
  return rows.map((r) => ({
    name: `${r.kind === "storno" ? "Stornorechnung" : "Rechnung"}-${r.invoice_number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
    data: r.pdf,
    date: r.issue_date,
  }));
}

function dosDateTime(day: string): { time: number; date: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { time: 0, date: ((y - 1980) << 9) | (m << 5) | d };
}

/** Einfaches ZIP-Archiv ohne Kompression. */
export function buildZip(files: { name: string; data: Buffer; date: string }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data) >>> 0;
    const { time, date } = dosDateTime(f.date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // Dateiname in UTF-8
    local.writeUInt16LE(0, 8); // gespeichert
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + f.data.length;
  }
  const centralSize = central.reduce((t, b) => t + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
