import type pg from "pg";

/**
 * E-Mails an Kundinnen: Bestellbestätigung und Rechnung. Sie landen im Postausgang
 * (siehe mail-outbox.ts), in derselben Transaktion wie ihr Anlass.
 */

const euro = (cents: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
const day = (d: string) => d.split("-").reverse().join(".");
const percent = (bp: number) => `${(bp / 100).toLocaleString("de-DE")} %`;

function salutation(c: { first_name: string | null; last_name: string | null; company_name: string | null }): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name;
  return name ? `Hallo ${name},` : "Hallo,";
}

function companyFooter(co: { legal_name: string; street: string; postal_code: string; city: string; vat_id: string | null; register_info: string | null }) {
  return [co.legal_name, co.street, `${co.postal_code} ${co.city}`, co.vat_id ? `USt-IdNr.: ${co.vat_id}` : null, co.register_info]
    .filter(Boolean)
    .join("\n");
}

/**
 * Bestellbestätigung mit Vertragsinhalt auf einem dauerhaften Datenträger (Art. 246a § 1 EGBGB, § 312f BGB):
 * Leistung, Preis und Zahlplan, AGB und Widerrufsbelehrung im Wortlaut der zugestimmten Fassung und,
 * falls erklärt, die Bestätigung des vorzeitigen Leistungsbeginns (§ 356 Abs. 5 BGB).
 */
export async function enqueueOrderConfirmation(client: pg.ClientBase, orderId: string, orderUrl: string): Promise<string> {
  const { rows } = await client.query(
    `select o.created_at, o.currency, o.total_gross_cents, o.withdrawal_waiver_at,
            cu.email, cu.first_name, cu.last_name, cu.company_name,
            co.legal_name, co.street, co.postal_code, co.city, co.vat_id, co.register_info,
            p.name product, po.label, it.tax_rate_bp, it.tax_note,
            agb.content agb_text, agb.version agb_version, wid.content widerruf_text, wid.version widerruf_version,
            dsg.version datenschutz_version
       from app.orders o
       join app.customers cu on cu.id = o.customer_id
       join app.companies co on co.id = o.company_id
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       join app.legal_text_versions agb on agb.id = o.agb_version_id
       join app.legal_text_versions wid on wid.id = o.withdrawal_version_id
       join app.legal_text_versions dsg on dsg.id = o.privacy_version_id
      where o.id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new Error("Bestellung gibt es nicht");
  const inst = await client.query<{ seq: number; due_date: string; gross_cents: string }>(
    `select seq, due_date::text, gross_cents from app.order_installments where order_id = $1 order by seq`,
    [orderId],
  );

  const lines = [
    salutation(o),
    "",
    `vielen Dank für deine Bestellung bei ${o.legal_name}. Hier ist deine Bestätigung mit allen Vertragsangaben.`,
    "",
    "Deine Bestellung",
    `- ${o.product} – ${o.label}`,
    `- Gesamtbetrag: ${euro(Number(o.total_gross_cents), o.currency)}`,
    o.tax_rate_bp > 0 ? `- darin enthalten: ${percent(o.tax_rate_bp)} Umsatzsteuer` : `- ${o.tax_note ?? "ohne Umsatzsteuer"}`,
    "",
    "Zahlplan",
    ...inst.rows.map((i) => `- ${day(i.due_date)}: ${euro(Number(i.gross_cents), o.currency)}`),
    "",
    `Zur Bestellung und Bezahlung: ${orderUrl}`,
    "Die Rechnung bekommst du per E-Mail, sobald die Zahlung eingegangen ist.",
  ];
  if (o.withdrawal_waiver_at) {
    lines.push(
      "",
      "Bestätigung zum Widerrufsrecht",
      "Du hast ausdrücklich zugestimmt, dass wir vor Ablauf der Widerrufsfrist mit der Leistung beginnen. " +
        "Dir ist bekannt, dass du dadurch dein Widerrufsrecht verlierst, sobald wir mit der Leistung begonnen haben (§ 356 Abs. 5 BGB).",
    );
  }
  lines.push(
    "",
    "Kündigen oder widerrufen kannst du jederzeit über die Links „Verträge hier kündigen“ und „Vertrag widerrufen“ auf unseren Bestellseiten.",
    "",
    `Widerrufsbelehrung (Fassung ${o.widerruf_version})`,
    "",
    o.widerruf_text,
    "",
    `Allgemeine Geschäftsbedingungen (Fassung ${o.agb_version})`,
    "",
    o.agb_text,
    "",
    `Du hast der Datenschutzerklärung in der Fassung ${o.datenschutz_version} zugestimmt.`,
    "",
    companyFooter(o),
  );

  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('bestellbestaetigung', $1, $2, $3, $4) returning id`,
    [o.email.trim().toLowerCase(), `Deine Bestellung: ${o.product}`, lines.join("\n"), orderId],
  );
  return mail.rows[0]!.id;
}

/** Rechnung per E-Mail. Das PDF hängt der Postausgang über related_id an, sobald es erzeugt ist. */
export async function enqueueInvoiceMail(client: pg.ClientBase, invoiceId: string): Promise<string> {
  const { rows } = await client.query(
    `select i.invoice_number, i.issue_date::text, i.currency, i.net_cents, i.tax_cents, i.gross_cents,
            i.customer_snapshot, i.company_snapshot
       from app.invoices i where i.id = $1`,
    [invoiceId],
  );
  const inv = rows[0];
  if (!inv) throw new Error("Rechnung gibt es nicht");
  const items = await client.query<{ description: string; gross_cents: string; tax_rate_bp: number; tax_exemption_note: string | null }>(
    `select description, gross_cents, tax_rate_bp, tax_exemption_note from app.invoice_items where invoice_id = $1 order by position`,
    [invoiceId],
  );
  const cu = inv.customer_snapshot;
  const lines = [
    salutation(cu),
    "",
    `danke für deine Zahlung. Anbei deine Rechnung ${inv.invoice_number} vom ${day(inv.issue_date)}.`,
    "",
    ...items.rows.map((i) => `- ${i.description}: ${euro(Number(i.gross_cents), inv.currency)}`),
    "",
    `Netto: ${euro(Number(inv.net_cents), inv.currency)}`,
    `Umsatzsteuer: ${euro(Number(inv.tax_cents), inv.currency)}`,
    `Gesamt: ${euro(Number(inv.gross_cents), inv.currency)}`,
    ...items.rows.filter((i) => i.tax_exemption_note).map((i) => i.tax_exemption_note!),
    "",
    "Der Betrag ist bereits bezahlt.",
    "",
    companyFooter(inv.company_snapshot),
  ];
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('rechnung', $1, $2, $3, $4) returning id`,
    [String(cu.email).trim().toLowerCase(), `Deine Rechnung ${inv.invoice_number}`, lines.join("\n"), invoiceId],
  );
  return mail.rows[0]!.id;
}
