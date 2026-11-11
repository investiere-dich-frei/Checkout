import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type pg from "pg";
import { BRAND, LOGO_PNG_BASE64, LOGO_PNG_HEIGHT, LOGO_PNG_WIDTH } from "./brand.ts";

/**
 * Rechnung als PDF mit den Pflichtangaben nach § 14 Abs. 4 UStG. Erzeugt aus den
 * Schnappschüssen der Rechnung, nicht aus den heutigen Stammdaten.
 */

export interface InvoiceData {
  invoiceNumber: string;
  kind: "rechnung" | "storno" | "korrektur";
  correctsNumber: string | null;
  issueDate: string;
  serviceFrom: string;
  serviceTo: string;
  currency: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
  note: string | null;
  company: { legal_name: string; street: string; postal_code: string; city: string; country: string; vat_id: string | null; tax_number: string | null; register_info: string | null };
  customer: {
    kind: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    country: string;
    vat_id: string | null;
    email: string;
  };
  items: { position: number; description: string; quantity: number; unitNetCents: number; netCents: number; taxRateBp: number; taxCents: number; grossCents: number; note: string | null }[];
  paid: boolean;
}

const countryName = new Intl.DisplayNames(["de"], { type: "region" });
const day = (d: string) => d.split("-").reverse().join(".");
const percent = (bp: number) => `${(bp / 100).toLocaleString("de-DE")} %`;
// Standardschrift kennt nur WinAnsi; das schmale Leerzeichen der Zahlformatierung ersetzen.
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100).replace(/[  ]/g, " ");
const safe = (s: string) => s.replace(/[  ]/g, " ").replace(/[–—]/g, "-").replace(/[„“”]/g, '"').replace(/[^\x20-\x7e -ÿ€]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n").map(safe)) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Hex-Farbe der Marke in pdf-lib-Farbe. */
function hex(h: string) {
  const n = Number.parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const INK = hex(BRAND.black);
const ROSE = hex(BRAND.darkRose);
const SOFT = hex(BRAND.textSoft);
const LINE = hex(BRAND.lightGrey);
const BAND = hex(BRAND.blush);

export async function renderInvoicePdf(d: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Feste Metadaten: dieselbe Rechnung ergibt dasselbe Dokument.
  const stamp = new Date(`${d.issueDate}T00:00:00Z`);
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  doc.setProducer("idf-checkout");
  doc.setCreator("idf-checkout");
  const title = d.kind === "storno" ? "Stornorechnung" : d.kind === "korrektur" ? "Rechnungskorrektur" : "Rechnung";
  doc.setTitle(`${title} ${d.invoiceNumber}`);
  doc.setAuthor(d.company.legal_name);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const left = 56;
  const right = 595.28 - 56;
  let y = 0;
  const text = (s: string, x: number, size = 10, f = font, color = INK) => page.drawText(safe(s), { x, y, size, font: f, color });
  const textRight = (s: string, x: number, size = 10, f = font, color = INK) =>
    page.drawText(safe(s), { x: x - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });
  const rule = (at: number, color = LINE, thickness = 0.75) => page.drawLine({ start: { x: left, y: at }, end: { x: right, y: at }, thickness, color });

  // Kopf: Logo links, Absender rechts, Linie in Dark Rose
  const c = d.company;
  const logoWidth = 180;
  const logoHeight = (logoWidth * LOGO_PNG_HEIGHT) / LOGO_PNG_WIDTH;
  page.drawImage(logo, { x: left, y: 800 - logoHeight, width: logoWidth, height: logoHeight });
  y = 790;
  for (const [i, l] of [c.legal_name, c.street, `${c.postal_code} ${c.city}`].entries()) {
    textRight(l, right, 8.5, i === 0 ? bold : font, i === 0 ? INK : SOFT);
    y -= 11;
  }
  rule(744, ROSE, 1.2);

  // Anschrift mit Absenderzeile (wie im Fensterumschlag)
  y = 712;
  text(`${c.legal_name} · ${c.street} · ${c.postal_code} ${c.city}`, left, 7, font, SOFT);
  y -= 18;
  const cu = d.customer;
  const buyer = [
    cu.company_name,
    [cu.first_name, cu.last_name].filter(Boolean).join(" ") || null,
    cu.street,
    [cu.postal_code, cu.city].filter(Boolean).join(" ") || null,
    cu.country !== "DE" ? (countryName.of(cu.country) ?? cu.country) : null,
    cu.vat_id ? `USt-IdNr.: ${cu.vat_id}` : null,
  ].filter((x): x is string => !!x);
  if (!cu.street) buyer.push(cu.email);
  const headY = y;
  for (const line of buyer) {
    text(line, left, 10);
    y -= 13;
  }

  // Rechnungsangaben rechts in einem hellen Kasten
  const meta: [string, string][] = [
    [title, d.invoiceNumber],
    ["Rechnungsdatum", day(d.issueDate)],
    ["Leistungsdatum", d.serviceFrom === d.serviceTo ? day(d.serviceFrom) : `${day(d.serviceFrom)} - ${day(d.serviceTo)}`],
  ];
  if (d.correctsNumber) meta.push(["zu Rechnung", d.correctsNumber]);
  const boxX = 330;
  const boxTop = headY + 14;
  const boxHeight = meta.length * 15 + 12;
  page.drawRectangle({ x: boxX, y: boxTop - boxHeight, width: right - boxX, height: boxHeight, color: BAND });
  y = headY;
  for (const [k, v] of meta) {
    text(k, boxX + 10, 8.5, font, SOFT);
    textRight(v, right - 10, 9.5, bold);
    y -= 15;
  }
  y = Math.min(headY - buyer.length * 13, boxTop - boxHeight) - 40;

  text(`${title} ${d.invoiceNumber}`, left, 18, bold, ROSE);
  y -= 28;

  // Tabelle mit hellem Kopfband
  const cols = { pos: left + 6, desc: left + 32, qty: 330, net: 405, rate: 452, gross: right - 6 };
  page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 20, color: LINE });
  text("Pos.", cols.pos, 8, bold);
  text("Leistung", cols.desc, 8, bold);
  textRight("Menge", cols.qty, 8, bold);
  textRight("Netto", cols.net, 8, bold);
  textRight("USt", cols.rate, 8, bold);
  textRight("Brutto", cols.gross, 8, bold);
  y -= 24;
  for (const it of d.items) {
    const lines = wrap(it.description, font, 9, cols.qty - 40 - cols.desc);
    text(String(it.position), cols.pos, 9);
    textRight(String(it.quantity), cols.qty, 9);
    textRight(money(it.netCents, d.currency), cols.net, 9);
    textRight(percent(it.taxRateBp), cols.rate, 9);
    textRight(money(it.grossCents, d.currency), cols.gross, 9);
    for (const l of lines) {
      text(l, cols.desc, 9);
      y -= 12;
    }
    y -= 4;
    rule(y + 8);
    y -= 6;
  }
  y -= 8;

  // Summen je Steuersatz, Gesamtbetrag hervorgehoben
  const rates = [...new Set(d.items.map((i) => i.taxRateBp))];
  const sumRow = (label: string, value: string) => {
    text(label, boxX + 10, 9.5, font, SOFT);
    textRight(value, right - 6, 9.5);
    y -= 15;
  };
  sumRow("Summe netto", money(d.netCents, d.currency));
  for (const r of rates) {
    const tax = d.items.filter((i) => i.taxRateBp === r).reduce((t, i) => t + i.taxCents, 0);
    const net = d.items.filter((i) => i.taxRateBp === r).reduce((t, i) => t + i.netCents, 0);
    sumRow(`Umsatzsteuer ${percent(r)} auf ${money(net, d.currency)}`, money(tax, d.currency));
  }
  y -= 4;
  page.drawRectangle({ x: boxX, y: y - 7, width: right - boxX, height: 22, color: BAND });
  page.drawLine({ start: { x: boxX, y: y + 15 }, end: { x: right, y: y + 15 }, thickness: 1.2, color: ROSE });
  text("Gesamtbetrag", boxX + 10, 11, bold);
  textRight(money(d.grossCents, d.currency), right - 6, 11, bold);
  y -= 36;

  const notes = [...new Set(d.items.map((i) => i.note).filter((n): n is string => !!n))];
  if (d.note) notes.push(d.note);
  if (d.paid) notes.push("Der Betrag ist bereits bezahlt. Vielen Dank!");
  for (const n of notes) {
    for (const l of wrap(n, font, 9, right - left)) {
      text(l, left, 9);
      y -= 12;
    }
    y -= 4;
  }

  // Fußzeile mit Pflichtangaben der Gesellschaft
  rule(78, ROSE, 0.75);
  y = 62;
  const footer = [
    `${c.legal_name} · ${c.street} · ${c.postal_code} ${c.city}`,
    [c.vat_id ? `USt-IdNr.: ${c.vat_id}` : null, c.tax_number ? `Steuernummer: ${c.tax_number}` : null, c.register_info].filter(Boolean).join(" · "),
  ];
  for (const l of footer) {
    text(l, left, 7.5, font, SOFT);
    y -= 11;
  }

  return doc.save({ useObjectStreams: false });
}

async function loadInvoice(client: pg.ClientBase, invoiceId: string): Promise<InvoiceData> {
  const { rows } = await client.query(
    `select i.invoice_number, i.kind, c.invoice_number corrects_number, i.issue_date::text, i.service_date_from::text,
            i.service_date_to::text, i.currency, i.net_cents, i.tax_cents, i.gross_cents, i.note,
            i.company_snapshot, i.customer_snapshot,
            exists (select 1 from app.order_installments x where x.invoice_id = i.id and x.status = 'bezahlt') paid
       from app.invoices i left join app.invoices c on c.id = i.corrects_invoice_id
      where i.id = $1`,
    [invoiceId],
  );
  const r = rows[0];
  if (!r) throw new Error("Rechnung gibt es nicht");
  const items = await client.query(
    `select position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note
       from app.invoice_items where invoice_id = $1 order by position`,
    [invoiceId],
  );
  return {
    invoiceNumber: r.invoice_number,
    kind: r.kind,
    correctsNumber: r.corrects_number,
    issueDate: r.issue_date,
    serviceFrom: r.service_date_from,
    serviceTo: r.service_date_to,
    currency: r.currency,
    netCents: Number(r.net_cents),
    taxCents: Number(r.tax_cents),
    grossCents: Number(r.gross_cents),
    note: r.note,
    company: r.company_snapshot,
    customer: r.customer_snapshot,
    paid: r.paid,
    items: items.rows.map((i) => ({
      position: i.position,
      description: i.description,
      quantity: i.quantity,
      unitNetCents: Number(i.unit_net_cents),
      netCents: Number(i.net_cents),
      taxRateBp: i.tax_rate_bp,
      taxCents: Number(i.tax_cents),
      grossCents: Number(i.gross_cents),
      note: i.tax_exemption_note,
    })),
  };
}

/** PDF erzeugen, ablegen und an der Rechnung vermerken. Läuft in der Transaktion des Aufrufers; einmal je Rechnung. */
export async function storeInvoicePdf(client: pg.ClientBase, invoiceId: string): Promise<{ documentId: string; sha256: string }> {
  const existing = await client.query<{ id: string; sha256: Buffer }>(`select id, sha256 from app.invoice_documents where invoice_id = $1`, [
    invoiceId,
  ]);
  if (existing.rows[0]) return { documentId: existing.rows[0].id, sha256: existing.rows[0].sha256.toString("hex") };

  const pdf = Buffer.from(await renderInvoicePdf(await loadInvoice(client, invoiceId)));
  const hash = createHash("sha256").update(pdf).digest();
  const doc = await client.query<{ id: string }>(
    `insert into app.invoice_documents (invoice_id, pdf, sha256) values ($1, $2, $3) returning id`,
    [invoiceId, pdf, hash],
  );
  const documentId = doc.rows[0]!.id;
  await client.query(`update app.invoices set pdf_sha256 = $2, pdf_storage_key = $3 where id = $1`, [invoiceId, hash, `db:${documentId}`]);
  return { documentId, sha256: hash.toString("hex") };
}

/** Abgelegtes PDF einer Rechnung, für den Mailanhang oder den Download. */
export async function invoicePdf(client: pg.Pool | pg.ClientBase, invoiceId: string): Promise<{ filename: string; pdf: Buffer } | null> {
  const { rows } = await client.query<{ pdf: Buffer; invoice_number: string }>(
    `select d.pdf, i.invoice_number from app.invoice_documents d join app.invoices i on i.id = d.invoice_id where d.invoice_id = $1`,
    [invoiceId],
  );
  const r = rows[0];
  return r ? { filename: `Rechnung-${r.invoice_number}.pdf`, pdf: r.pdf } : null;
}
