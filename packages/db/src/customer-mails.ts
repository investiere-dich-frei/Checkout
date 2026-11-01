import type pg from "pg";
import { ACCESS_DELAY_DAYS, SOFORTSTART_TEXT, SOFORTSTART_VERSION } from "./legal.ts";

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
 * die Bestätigung des freiwilligen Sofortstarts (§ 357a Abs. 2 BGB) oder ohne ihn der Starttermin nach Fristablauf.
 */
export async function enqueueOrderConfirmation(client: pg.ClientBase, orderId: string, orderUrl: string): Promise<string> {
  const { rows } = await client.query(
    `select o.created_at, o.currency, o.total_gross_cents, o.withdrawal_waiver_at, p.immediate_access,
            ((o.created_at at time zone 'Europe/Berlin')::date + $2::int)::text access_from,
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
    [orderId, ACCESS_DELAY_DAYS],
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
      "Dein Sofortstart",
      `Du hast beim Kauf erklärt: „${SOFORTSTART_TEXT}“ (Fassung ${SOFORTSTART_VERSION})`,
      "Was das bei einem Widerruf bedeutet, steht unten in der Widerrufsbelehrung.",
    );
  } else if (o.immediate_access) {
    lines.push("", "Dein Start", "Deinen Zugang bekommst du sofort.");
  } else {
    lines.push(
      "",
      "Dein Start",
      `Du hast keinen Sofortstart gewählt. Deinen Zugang bekommst du am ${day(o.access_from)}, am Tag nach Ablauf der Widerrufsfrist.`,
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
export async function enqueueInvoiceMail(client: pg.ClientBase, invoiceId: string, toAddress?: string): Promise<string> {
  const { rows } = await client.query(
    `select i.invoice_number, i.kind, c.invoice_number corrects_number, i.issue_date::text, i.currency, i.net_cents,
            i.tax_cents, i.gross_cents, i.customer_snapshot, i.company_snapshot
       from app.invoices i left join app.invoices c on c.id = i.corrects_invoice_id where i.id = $1`,
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
    inv.kind === "storno"
      ? `wir haben dir den Betrag der Rechnung ${inv.corrects_number} erstattet. Anbei die Stornorechnung ${inv.invoice_number} vom ${day(inv.issue_date)}.`
      : `danke für deine Zahlung. Anbei deine Rechnung ${inv.invoice_number} vom ${day(inv.issue_date)}.`,
    "",
    ...items.rows.map((i) => `- ${i.description}: ${euro(Number(i.gross_cents), inv.currency)}`),
    "",
    `Netto: ${euro(Number(inv.net_cents), inv.currency)}`,
    `Umsatzsteuer: ${euro(Number(inv.tax_cents), inv.currency)}`,
    `Gesamt: ${euro(Number(inv.gross_cents), inv.currency)}`,
    ...items.rows.filter((i) => i.tax_exemption_note).map((i) => i.tax_exemption_note!),
    "",
    inv.kind === "storno" ? "Die Erstattung erfolgt über die Zahlungsart, mit der du bezahlt hast." : "Der Betrag ist bereits bezahlt.",
    "",
    companyFooter(inv.company_snapshot),
  ];
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('rechnung', $1, $2, $3, $4) returning id`,
    [
      String(toAddress ?? cu.email).trim().toLowerCase(),
      `${inv.kind === "storno" ? "Deine Stornorechnung" : "Deine Rechnung"} ${inv.invoice_number}`,
      lines.join("\n"),
      invoiceId,
    ],
  );
  return mail.rows[0]!.id;
}

const MODEL_TEXT: Record<string, string> = {
  einmal: "Einmalzahlung",
  anzahlung_rest: "Anzahlung und Restzahlung",
  anzahlung_raten: "Anzahlung und Raten",
  raten: "Ratenzahlung",
};

/**
 * Manuelle Bestellung: Rechnung vorab mit Zahlungsplan und Bankverbindung. Die Mail ist zugleich
 * die Vertragsbestätigung auf einem dauerhaften Datenträger, deshalb mit Widerrufsbelehrung und AGB
 * im Wortlaut der Fassung, die zur Bestellung gehört. Das PDF hängt der Postausgang an.
 */
export async function enqueueManualInvoiceMail(client: pg.ClientBase, orderId: string, toAddress?: string): Promise<string> {
  const { rows } = await client.query(
    `select m.invoice_id, m.payment_model, m.pay_by::text pay_by, i.invoice_number, i.gross_cents, o.currency, p.name product, p.immediate_access,
            ((o.created_at at time zone 'Europe/Berlin')::date + $2::int)::text access_from,
            cu.email, cu.first_name, cu.last_name, cu.company_name,
            co.legal_name, co.street, co.postal_code, co.city, co.vat_id, co.register_info, co.bank_name, co.iban, co.bic,
            agb.content agb_text, agb.version agb_version, wid.content widerruf_text, wid.version widerruf_version,
            dsg.version datenschutz_version
       from app.manual_orders m
       join app.invoices i on i.id = m.invoice_id
       join app.orders o on o.id = m.order_id
       join app.customers cu on cu.id = o.customer_id
       join app.companies co on co.id = o.company_id
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       join app.legal_text_versions agb on agb.id = o.agb_version_id
       join app.legal_text_versions wid on wid.id = o.withdrawal_version_id
       join app.legal_text_versions dsg on dsg.id = o.privacy_version_id
      where m.order_id = $1`,
    [orderId, ACCESS_DELAY_DAYS],
  );
  const o = rows[0];
  if (!o) throw new Error("Manuelle Bestellung gibt es nicht");
  const inst = await client.query<{ seq: number; due: string; gross_cents: string; status: string }>(
    `select seq, greatest(due_date, $2::date)::text due, gross_cents, status from app.order_installments where order_id = $1 order by seq`,
    [orderId, o.pay_by],
  );
  const open = inst.rows.filter((i) => i.status !== "bezahlt");
  const lines = [
    salutation(o),
    "",
    `vielen Dank für deine Bestellung bei ${o.legal_name}. Anbei deine Rechnung ${o.invoice_number} über ${euro(Number(o.gross_cents), o.currency)} für ${o.product}.`,
    "",
  ];
  if (open.length === 0) {
    lines.push("Der Betrag ist bereits bezahlt. Danke!");
  } else {
    if (o.payment_model === "einmal") {
      lines.push(`Bitte überweise den Betrag bis zum ${day(open[0]!.due)}.`);
    } else {
      lines.push(`Zahlungsplan (${MODEL_TEXT[o.payment_model] ?? o.payment_model}):`);
      for (const i of inst.rows) {
        lines.push(`- ${i.seq}. Zahlung: ${euro(Number(i.gross_cents), o.currency)}, ${i.status === "bezahlt" ? "bezahlt" : `fällig ${i.seq === 1 ? "bis" : "am"} ${day(i.due)}`}`);
      }
    }
    lines.push(
      "",
      "Bankverbindung",
      `Kontoinhaber: ${o.legal_name}`,
      ...(o.bank_name ? [`Bank: ${o.bank_name}`] : []),
      `IBAN: ${String(o.iban).replace(/(.{4})/g, "$1 ").trim()}`,
      ...(o.bic ? [`BIC: ${o.bic}`] : []),
      `Verwendungszweck: ${o.invoice_number}`,
    );
  }
  lines.push(
    "",
    "Dein Start",
    o.immediate_access
      ? "Deinen Zugang bekommst du, sobald deine Zahlung eingegangen ist."
      : `Deinen Zugang bekommst du, sobald deine ${o.payment_model === "einmal" ? "" : "erste "}Zahlung eingegangen ist, frühestens am ${day(o.access_from)}, am Tag nach Ablauf der Widerrufsfrist.`,
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
    `Es gilt unsere Datenschutzerklärung in der Fassung ${o.datenschutz_version}.`,
    "",
    companyFooter(o),
  );
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('rechnung', $1, $2, $3, $4) returning id`,
    [String(toAddress ?? o.email).trim().toLowerCase(), `Deine Rechnung ${o.invoice_number}`, lines.join("\n"), o.invoice_id],
  );
  return mail.rows[0]!.id;
}

/** Manuelle Bestellung storniert: Stornorechnung an die Kundin, mit Hinweis zur Rückzahlung. */
export async function enqueueManualStornoMail(client: pg.ClientBase, orderId: string, toAddress?: string): Promise<string> {
  const { rows } = await client.query(
    `select m.storno_invoice_id, m.refund_due_cents, s.invoice_number storno_number, s.issue_date::text storno_date, i.invoice_number,
            o.currency, s.customer_snapshot, s.company_snapshot
       from app.manual_orders m
       join app.invoices s on s.id = m.storno_invoice_id
       join app.invoices i on i.id = m.invoice_id
       join app.orders o on o.id = m.order_id
      where m.order_id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) throw new Error("Storno gibt es nicht");
  const refund = Number(o.refund_due_cents ?? 0);
  const lines = [
    salutation(o.customer_snapshot),
    "",
    `wir haben deine Rechnung ${o.invoice_number} storniert. Anbei die Stornorechnung ${o.storno_number} vom ${day(o.storno_date)}.`,
    "",
    refund > 0
      ? `Die bereits gezahlten ${euro(refund, o.currency)} überweisen wir dir auf das Konto zurück, von dem du gezahlt hast.`
      : "Du musst nichts mehr bezahlen.",
    "",
    companyFooter(o.company_snapshot),
  ];
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('rechnung', $1, $2, $3, $4) returning id`,
    [String(toAddress ?? o.customer_snapshot.email).trim().toLowerCase(), `Deine Stornorechnung ${o.storno_number}`, lines.join("\n"), o.storno_invoice_id],
  );
  return mail.rows[0]!.id;
}

/**
 * Rechnung oder Stornorechnung erneut per E-Mail schicken, mit demselben Text wie beim ersten Versand
 * und dem PDF als Anhang. Die Rechnung selbst bleibt unverändert; der neue Versand steht im Postausgang.
 */
export async function resendInvoiceMail(client: pg.ClientBase, invoiceId: string, toAddress?: string): Promise<string> {
  const to = toAddress?.trim() || undefined;
  if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
  const { rows } = await client.query<{ order_id: string; manual_invoice: boolean; manual_storno: boolean }>(
    `select m.order_id, m.invoice_id = $1 manual_invoice, coalesce(m.storno_invoice_id = $1, false) manual_storno
       from app.manual_orders m where m.invoice_id = $1 or m.storno_invoice_id = $1`,
    [invoiceId],
  );
  const m = rows[0];
  if (m?.manual_invoice) return enqueueManualInvoiceMail(client, m.order_id, to);
  if (m?.manual_storno) return enqueueManualStornoMail(client, m.order_id, to);
  return enqueueInvoiceMail(client, invoiceId, to);
}
