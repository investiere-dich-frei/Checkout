import { MANUAL_MODEL_LABEL, manualPlan, ManualPlanError, type ManualPaymentModel, type ManualPlanInput } from "@idf/core/manual-plan";
import { splitAmount } from "@idf/core/pricing";
import { decideTax, type TaxCategory } from "@idf/core/tax";
import type pg from "pg";
import { canChange, canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";
import { enqueueManualInvoiceMail, enqueueManualStornoMail } from "./customer-mails.ts";
import { storeInvoicePdf } from "./invoice-pdf.ts";
import type { CustomerInput } from "./orders.ts";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Manuelle Bestellungen: Rechnung zuerst, Zahlung per Überweisung (bisher n8n
 * „IDF Manuelle Bestellung“). Alles geschieht in der Transaktion des Aufrufers.
 *
 *  - Anlegen: Bestellung, Fälligkeiten und eine Rechnung über den Gesamtbetrag im
 *    Kreis IDF-n mit Zahlungsplan und Bankverbindung; PDF und Mail an die Kundin.
 *  - Zahlung verbuchen: je Fälligkeit, von Hand nach Blick aufs Konto.
 *  - Storno: Stornorechnung über den vollen Betrag, offene Fälligkeiten entfallen.
 *    Bereits Gezahltes wird zurücküberwiesen und danach als Rückzahlung verbucht.
 */

type Db = pg.Pool | pg.ClientBase;

export class ManualOrderError extends Error {}

const euro = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100).replace(/[\u00a0\u202f]/g, " ");
const day = (d: string) => d.split("-").reverse().join(".");
const formatIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

export const canCreateManual = (u: SessionUser) => u.role !== "pruefer";

export interface ManualOrderInput {
  productId: string;
  customer: CustomerInput;
  /** USt-IdNr. per VIES geprüft. Nur dann gilt Reverse Charge. */
  vatIdVerified: boolean;
  /** Vertriebsperson; bei Vertrieb und Freelancern immer die angemeldete Person. */
  sellerUserId: string | null;
  plan: Omit<ManualPlanInput, "issueDay">;
  /** Rechnungstag in Europe/Berlin, YYYY-MM-DD. */
  issueDay: string;
  /** Erste Zahlung ist schon auf dem Konto (bisher „Überweisung erfassen“). */
  alreadyPaid: { paidOn: string; reference: string } | null;
  /** Rechnung per E-Mail an die Kundin. */
  sendMail: boolean;
  internalNote: string | null;
}

export interface CreatedManualOrder {
  orderId: string;
  invoiceId: string;
  invoiceNumber: string;
  totalCents: number;
}

interface ProductRow {
  name: string;
  tax_category: TaxCategory;
  tax_confirmed_at: Date | null;
  company_id: string;
  ch_vat_rate_bp: number | null;
  legal_name: string;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
}

/** Zahlungsplan und Bankverbindung als Text, so wie er auf der Rechnung steht. */
export function paymentNote(input: {
  model: ManualPaymentModel;
  installments: { label: string; dueDate: string; grossCents: number; paidOn?: string | null }[];
  currency: string;
  invoiceNumber: string;
  company: { legal_name: string; bank_name: string | null; iban: string; bic: string | null };
}): string {
  const lines: string[] = [];
  const all = input.installments;
  const allPaid = all.every((i) => i.paidOn);
  if (input.model === "einmal") {
    const i = all[0]!;
    lines.push(i.paidOn ? `Der Betrag wurde am ${day(i.paidOn)} per Überweisung bezahlt.` : `Zahlbar per Überweisung bis zum ${day(i.dueDate)}.`);
  } else {
    lines.push(`Zahlungsplan (${MANUAL_MODEL_LABEL[input.model]}):`);
    for (const [n, i] of all.entries()) {
      const when = i.paidOn ? `bezahlt am ${day(i.paidOn)}` : n === 0 ? `fällig bis ${day(i.dueDate)}` : `fällig am ${day(i.dueDate)}`;
      lines.push(`- ${i.label}: ${euro(i.grossCents, input.currency)}, ${when}`);
    }
  }
  if (!allPaid) {
    const c = input.company;
    lines.push(
      `Bankverbindung: ${[c.legal_name, c.bank_name, `IBAN ${formatIban(c.iban)}`, c.bic ? `BIC ${c.bic}` : null].filter(Boolean).join(" · ")}`,
      `Verwendungszweck: ${input.invoiceNumber}`,
    );
  }
  return lines.join("\n");
}

/** Verdeckte Preisoption des Produkts für vereinbarte Beträge; wird beim ersten Mal angelegt. */
async function manualPriceOption(client: pg.ClientBase, productId: string): Promise<string> {
  await client.query(
    `insert into app.price_options (product_id, label, kind, currency, amount_cents, amount_basis, active, manual_only)
     values ($1, 'Manuelle Bestellung (Betrag laut Rechnung)', 'einmal', 'EUR', 0, 'brutto', false, true)
     on conflict (product_id) where manual_only do nothing`,
    [productId],
  );
  const { rows } = await client.query<{ id: string }>(`select id from app.price_options where product_id = $1 and manual_only`, [productId]);
  return rows[0]!.id;
}

async function event(client: pg.ClientBase, orderId: string, kind: string, userId: string, detail: string) {
  await client.query(`insert into app.manual_order_events (order_id, kind, user_id, detail) values ($1, $2, $3, $4)`, [orderId, kind, userId, detail]);
}

export async function createManualOrder(client: pg.ClientBase, user: SessionUser, input: ManualOrderInput): Promise<CreatedManualOrder> {
  if (!canCreateManual(user)) throw new ManualOrderError("Keine Berechtigung");
  // Vertrieb und Freelancer verkaufen immer selbst; nur Admins können die Vertriebsperson wählen.
  const sellerUserId = canChange(user) ? input.sellerUserId : user.id;
  if (input.alreadyPaid && !canChange(user)) throw new ManualOrderError("Zahlungseingänge verbucht die Buchhaltung.");

  const p = (
    await client.query<ProductRow>(
      `select p.name, p.tax_category, p.tax_confirmed_at, p.company_id, c.ch_vat_rate_bp, c.legal_name, c.bank_name, c.iban, c.bic
         from app.products p join app.companies c on c.id = p.company_id where p.id = $1`,
      [input.productId],
    )
  ).rows[0];
  if (!p) throw new ManualOrderError("Produkt gibt es nicht.");
  if (!p.tax_confirmed_at) throw new ManualOrderError("Für dieses Produkt ist die Steuer noch nicht bestätigt (Verwaltung → Produkte).");
  if (!p.iban) throw new ManualOrderError("Für die Gesellschaft ist keine Bankverbindung hinterlegt. Bitte Christian Bescheid geben.");

  const legal = await client.query<{ id: string; kind: string }>(
    `select distinct on (kind) id, kind from app.legal_text_versions where valid_from <= now() order by kind, valid_from desc`,
  );
  const legalId = (k: string) => legal.rows.find((r) => r.kind === k)?.id;
  if (!legalId("agb") || !legalId("datenschutz") || !legalId("widerruf")) throw new ManualOrderError("Rechtstexte fehlen.");

  if (sellerUserId) {
    const s = await client.query(`select 1 from app.users where id = $1 and active and role in ('admin', 'vertrieb', 'freelancer')`, [sellerUserId]);
    if (!s.rowCount) throw new ManualOrderError("Diese Vertriebsperson gibt es nicht oder sie ist gesperrt.");
  }

  let schedule;
  try {
    schedule = manualPlan({ ...input.plan, issueDay: input.issueDay });
  } catch (err) {
    if (err instanceof ManualPlanError) throw new ManualOrderError(err.message);
    throw err;
  }
  if (input.alreadyPaid) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.alreadyPaid.paidOn) || input.alreadyPaid.paidOn > input.issueDay) {
      throw new ManualOrderError("Das Zahlungsdatum darf nicht in der Zukunft liegen.");
    }
  }

  const c = input.customer;
  const isBusiness = c.kind === "unternehmen";
  const tax = decideTax(
    p.tax_category,
    { country: c.country, isBusiness, vatIdVerified: isBusiness && input.vatIdVerified && !!c.vat_id },
    { chVatRateBp: p.ch_vat_rate_bp },
  );
  const parts = schedule.map((s) => ({ ...s, ...splitAmount(s.grossCents, "brutto", tax.rateBp) }));
  const sum = (k: "netCents" | "taxCents" | "grossCents") => parts.reduce((t, x) => t + x[k], 0);
  const currency = "EUR";
  const optionId = await manualPriceOption(client, input.productId);

  const customerId = (
    await client.query<{ id: string }>(
      `insert into app.customers (kind, first_name, last_name, company_name, email, street, postal_code, city, country, vat_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [c.kind, c.first_name ?? null, c.last_name ?? null, c.company_name ?? null, c.email.trim(), c.street ?? null, c.postal_code ?? null, c.city ?? null, c.country.toUpperCase(), c.vat_id ?? null],
    )
  ).rows[0]!.id;

  const orderId = (
    await client.query<{ id: string }>(
      `insert into app.orders (company_id, customer_id, seller_user_id, status, currency, total_gross_cents,
         agb_version_id, privacy_version_id, withdrawal_version_id, buyer_country, buyer_is_business)
       values ($1, $2, $3, 'offen', $4, $5, $6, $7, $8, $9, $10) returning id`,
      [p.company_id, customerId, sellerUserId, currency, sum("grossCents"), legalId("agb"), legalId("datenschutz"), legalId("widerruf"), c.country.toUpperCase(), isBusiness],
    )
  ).rows[0]!.id;

  const itemId = (
    await client.query<{ id: string }>(
      `insert into app.order_items (order_id, price_option_id, quantity, amount_cents, net_cents, tax_cents, gross_cents,
         tax_rate_bp, tax_note, tax_rule, tax_rules_version)
       values ($1, $2, 1, $3, $4, $5, $3, $6, $7, $8, $9) returning id`,
      [orderId, optionId, sum("grossCents"), sum("netCents"), sum("taxCents"), tax.rateBp, tax.note, tax.rule, tax.rulesVersion],
    )
  ).rows[0]!.id;

  const installmentIds: string[] = [];
  for (const i of parts) {
    const r = await client.query<{ id: string }>(
      `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orderId, itemId, i.seq, i.dueDate, i.netCents, i.taxCents, i.grossCents],
    );
    installmentIds.push(r.rows[0]!.id);
  }

  // Die Nummer steht im Zahlungshinweis (Verwendungszweck). Die Sperre auf den Nummernkreis
  // stellt sicher, dass genau diese Nummer gleich vergeben wird.
  const series = (
    await client.query<{ next: string }>(
      `select prefix || next_value next from app.invoice_number_series where company_id = $1 for update`,
      [p.company_id],
    )
  ).rows[0];
  if (!series) throw new ManualOrderError("Für die Gesellschaft gibt es keinen Rechnungsnummernkreis.");
  const note = paymentNote({
    model: input.plan.model,
    installments: parts.map((i, n) => ({ ...i, paidOn: n === 0 ? (input.alreadyPaid?.paidOn ?? null) : null })),
    currency,
    invoiceNumber: series.next,
    company: { legal_name: p.legal_name, bank_name: p.bank_name, iban: p.iban, bic: p.bic },
  });
  const invoice = (
    await client.query<{ id: string; invoice_number: string }>(
      `insert into app.invoices (company_id, number_seq, invoice_number, kind, order_id, customer_id,
         customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency,
         net_cents, tax_cents, gross_cents, note)
       select $1, 0, '', 'rechnung', $2, $3, to_jsonb(cu), to_jsonb(co), $4, $4, $4, $5, $6, $7, $8, $9
         from app.customers cu, app.companies co where cu.id = $3 and co.id = $1
       returning id, invoice_number`,
      [p.company_id, orderId, customerId, input.issueDay, currency, sum("netCents"), sum("taxCents"), sum("grossCents"), note],
    )
  ).rows[0]!;
  if (invoice.invoice_number !== series.next) throw new Error("Rechnungsnummer weicht vom Verwendungszweck ab");
  const description = input.plan.model === "einmal" ? p.name : `${p.name} – ${MANUAL_MODEL_LABEL[input.plan.model]} (Zahlungsplan siehe unten)`;
  await client.query(
    `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents,
       tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
     values ($1, 1, $2, 1, $3, $3, $4, $5, $6, $7)`,
    [invoice.id, description, sum("netCents"), tax.rateBp, sum("taxCents"), sum("grossCents"), tax.note],
  );

  await client.query(
    `insert into app.manual_orders (order_id, invoice_id, payment_model, payment_term_days, pay_by, created_by, internal_note)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [orderId, invoice.id, input.plan.model, input.plan.paymentTermDays, parts[0]!.dueDate, user.id, input.internalNote?.trim() || null],
  );
  await event(client, orderId, "angelegt", user.id, `Rechnung ${invoice.invoice_number} über ${euro(sum("grossCents"), currency)} (${MANUAL_MODEL_LABEL[input.plan.model]})`);

  await storeInvoicePdf(client, invoice.id);
  if (input.alreadyPaid) {
    await recordManualPayment(client, user, orderId, installmentIds[0]!, input.alreadyPaid.paidOn, input.alreadyPaid.reference);
  }
  if (input.sendMail) await enqueueManualInvoiceMail(client, orderId);
  return { orderId, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, totalCents: sum("grossCents") };
}

interface LockedManual {
  order_id: string;
  invoice_id: string;
  invoice_number: string;
  payment_model: ManualPaymentModel;
  cancelled_at: Date | null;
  refund_due_cents: string | null;
  refunded_at: Date | null;
  storno_invoice_id: string | null;
  currency: string;
}

async function lockManual(client: pg.ClientBase, orderId: string): Promise<LockedManual> {
  const { rows } = await client.query<LockedManual>(
    `select m.order_id, m.invoice_id, i.invoice_number, m.payment_model, m.cancelled_at, m.refund_due_cents, m.refunded_at,
            m.storno_invoice_id, o.currency
       from app.manual_orders m join app.invoices i on i.id = m.invoice_id join app.orders o on o.id = m.order_id
      where m.order_id = $1
      for update of m, o`,
    [orderId],
  );
  if (!rows[0]) throw new ManualOrderError("Manuelle Bestellung gibt es nicht.");
  return rows[0];
}

/** Zahlungseingang zu einer Fälligkeit verbuchen. Eine Rechnung entsteht nicht, sie gibt es schon. */
export async function recordManualPayment(
  client: pg.ClientBase,
  user: SessionUser,
  orderId: string,
  installmentId: string,
  paidOn: string,
  reference: string,
): Promise<void> {
  if (!canChange(user)) throw new ManualOrderError("Keine Berechtigung");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new ManualOrderError("Bitte das Datum des Zahlungseingangs angeben.");
  const m = await lockManual(client, orderId);
  if (m.cancelled_at) throw new ManualOrderError("Die Bestellung ist storniert.");
  const inst = (
    await client.query<{ id: string; seq: number; status: string; gross_cents: string; today: string }>(
      `select id, seq, status, gross_cents, (now() at time zone 'Europe/Berlin')::date::text today
         from app.order_installments where id = $1 and order_id = $2 for update`,
      [installmentId, orderId],
    )
  ).rows[0];
  if (!inst) throw new ManualOrderError("Diese Zahlung gehört nicht zur Bestellung.");
  if (inst.status !== "offen" && inst.status !== "fehlgeschlagen") throw new ManualOrderError(`Zahlung ${inst.seq} ist bereits ${inst.status}.`);
  if (paidOn > inst.today) throw new ManualOrderError("Das Zahlungsdatum darf nicht in der Zukunft liegen.");

  const payment = await client.query<{ id: string }>(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, 'ueberweisung', $2, 'bezahlt', $3, $4, ($5::date + time '12:00') at time zone 'Europe/Berlin') returning id`,
    [orderId, `${m.invoice_number}/${inst.seq}`, m.currency, inst.gross_cents, paidOn],
  );
  await client.query(`update app.order_installments set status = 'bezahlt', payment_id = $2 where id = $1`, [inst.id, payment.rows[0]!.id]);
  await client.query(
    `update app.orders o
        set status = case when exists (
              select 1 from app.order_installments x where x.order_id = o.id and x.status in ('offen', 'fehlgeschlagen'))
            then 'teilbezahlt' else 'bezahlt' end
      where o.id = $1`,
    [orderId],
  );
  const ref = reference.trim();
  await event(client, orderId, "zahlung", user.id, `Zahlung ${inst.seq} über ${euro(Number(inst.gross_cents), m.currency)} am ${day(paidOn)} eingegangen${ref ? ` · ${ref}` : ""}`);
  // Kurszugang und CRM wie bei Kartenzahlungen (n8n). Die Rechnung ist die vorab ausgestellte.
  await enqueueWebhook(client, "zahlung.eingegangen", orderId, {
    payment: { provider: "ueberweisung", seq: inst.seq, first: inst.seq === 1, gross_cents: Number(inst.gross_cents), invoice_number: m.invoice_number },
    manual: { payment_model: m.payment_model },
  });
}

/**
 * Stornieren: Stornorechnung über den vollen Rechnungsbetrag, offene Zahlungen entfallen.
 * Was schon gezahlt ist, steht danach als Rückzahlung offen.
 */
export async function cancelManualOrder(
  client: pg.ClientBase,
  user: SessionUser,
  orderId: string,
  reason: string,
  notifyCustomer: boolean,
): Promise<{ stornoNumber: string; refundDueCents: number }> {
  if (!canChange(user)) throw new ManualOrderError("Keine Berechtigung");
  if (!reason.trim()) throw new ManualOrderError("Bitte einen Grund angeben.");
  const m = await lockManual(client, orderId);
  if (m.cancelled_at) throw new ManualOrderError("Die Bestellung ist bereits storniert.");
  const paid = Number(
    (
      await client.query<{ paid: string }>(
        `select coalesce(sum(gross_cents), 0) paid from app.order_installments where order_id = $1 and status = 'bezahlt'`,
        [orderId],
      )
    ).rows[0]!.paid,
  );
  const orig = (await client.query<{ issue_date: string }>(`select issue_date::text from app.invoices where id = $1`, [m.invoice_id])).rows[0]!;
  const note =
    paid > 0
      ? `Storno zu Rechnung ${m.invoice_number} vom ${day(orig.issue_date)}. Bereits gezahlte ${euro(paid, m.currency)} werden per Überweisung zurückgezahlt.`
      : `Storno zu Rechnung ${m.invoice_number} vom ${day(orig.issue_date)}. Es ist keine Zahlung eingegangen; der Betrag ist nicht mehr zu zahlen.`;
  const s = (
    await client.query<{ id: string; invoice_number: string }>(
      `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
         customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
       select company_id, 0, '', 'storno', id, order_id, customer_id, customer_snapshot, company_snapshot,
              (now() at time zone 'Europe/Berlin')::date, service_date_from, service_date_to, currency,
              -net_cents, -tax_cents, -gross_cents, $2
         from app.invoices where id = $1
       returning id, invoice_number`,
      [m.invoice_id, note],
    )
  ).rows[0]!;
  await client.query(
    `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
     select $1, position, description, -quantity, unit_net_cents, -net_cents, tax_rate_bp, -tax_cents, -gross_cents, tax_exemption_note
       from app.invoice_items where invoice_id = $2 order by position`,
    [s.id, m.invoice_id],
  );
  await client.query(`update app.order_installments set status = 'storniert' where order_id = $1 and status in ('offen', 'fehlgeschlagen')`, [orderId]);
  await client.query(`update app.orders set status = 'storniert' where id = $1`, [orderId]);
  await client.query(
    `update app.manual_orders set cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, storno_invoice_id = $4, refund_due_cents = $5
      where order_id = $1`,
    [orderId, user.id, reason.trim(), s.id, paid],
  );
  await event(
    client,
    orderId,
    "storno",
    user.id,
    `Stornorechnung ${s.invoice_number}${paid > 0 ? `, Rückzahlung ${euro(paid, m.currency)} offen` : ", keine Zahlung eingegangen"} · Grund: ${reason.trim()}${notifyCustomer ? "" : " · ohne Mail an die Kundin"}`,
  );
  await storeInvoicePdf(client, s.id);
  if (notifyCustomer) await enqueueManualStornoMail(client, orderId);
  // War schon Geld da, kann der Zugang laufen; n8n beendet ihn.
  if (paid > 0) await enqueueWebhook(client, "bestellung.beendet", orderId, { ended_by: `user:${user.id}`, storno_number: s.invoice_number });
  return { stornoNumber: s.invoice_number, refundDueCents: paid };
}

/** Rückzahlung nach Storno verbuchen, nachdem sie überwiesen ist. */
export async function recordManualRefund(client: pg.ClientBase, user: SessionUser, orderId: string, refundedOn: string, reference: string): Promise<void> {
  if (!canChange(user)) throw new ManualOrderError("Keine Berechtigung");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refundedOn)) throw new ManualOrderError("Bitte das Datum der Rücküberweisung angeben.");
  const m = await lockManual(client, orderId);
  if (!m.cancelled_at) throw new ManualOrderError("Zurückgezahlt wird erst nach dem Storno.");
  const due = Number(m.refund_due_cents ?? 0);
  if (due <= 0) throw new ManualOrderError("Es ist nichts zurückzuzahlen.");
  if (m.refunded_at) throw new ManualOrderError("Die Rückzahlung ist bereits verbucht.");
  const storno = (await client.query<{ invoice_number: string }>(`select invoice_number from app.invoices where id = $1`, [m.storno_invoice_id])).rows[0]!;
  await client.query(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, 'ueberweisung', $2, 'erstattet', $3, $4, ($5::date + time '12:00') at time zone 'Europe/Berlin')`,
    [orderId, `rueckzahlung/${storno.invoice_number}`, m.currency, -due, refundedOn],
  );
  await client.query(`update app.order_installments set status = 'storniert' where order_id = $1 and status = 'bezahlt'`, [orderId]);
  await client.query(`update app.orders set status = 'erstattet' where id = $1`, [orderId]);
  await client.query(`update app.manual_orders set refunded_at = now(), refunded_by = $2, refund_reference = $3 where order_id = $1`, [
    orderId,
    user.id,
    reference.trim() || null,
  ]);
  await event(client, orderId, "rueckzahlung", user.id, `${euro(due, m.currency)} am ${day(refundedOn)} zurücküberwiesen${reference.trim() ? ` · ${reference.trim()}` : ""}`);
  await enqueueWebhook(client, "zahlung.erstattet", orderId, {
    refund: { provider: "ueberweisung", gross_cents: due, storno_number: storno.invoice_number },
  });
}

export type ManualStatus = "offen" | "ueberfaellig" | "teilbezahlt" | "bezahlt" | "storniert" | "rueckzahlung_offen";

export const MANUAL_STATUS_LABEL: Record<ManualStatus, string> = {
  offen: "Offen",
  ueberfaellig: "Überfällig",
  teilbezahlt: "Teilbezahlt",
  bezahlt: "Bezahlt",
  storniert: "Storniert",
  rueckzahlung_offen: "Rückzahlung offen",
};

export interface ManualOrderRow {
  orderId: string;
  invoiceNumber: string;
  issueDate: string;
  customerName: string;
  email: string;
  product: string;
  model: ManualPaymentModel;
  currency: string;
  totalCents: number;
  paidCents: number;
  /** Nächste offene Zahlung (Fälligkeit nie vor dem Zahlungsziel). */
  nextDue: string | null;
  nextDueCents: number | null;
  status: ManualStatus;
  seller: string | null;
}

// Fälligkeit einer Zahlung: nie vor dem Zahlungsziel der Rechnung.
const DUE = `greatest(i.due_date, m.pay_by)`;

const STATUS_SQL = `case
  when m.cancelled_at is not null and m.refund_due_cents > 0 and m.refunded_at is null then 'rueckzahlung_offen'
  when m.cancelled_at is not null then 'storniert'
  when not exists (select 1 from app.order_installments i where i.order_id = m.order_id and i.status in ('offen', 'fehlgeschlagen')) then 'bezahlt'
  when exists (select 1 from app.order_installments i where i.order_id = m.order_id and i.status in ('offen', 'fehlgeschlagen') and ${DUE} < $1::date) then 'ueberfaellig'
  when exists (select 1 from app.order_installments i where i.order_id = m.order_id and i.status = 'bezahlt') then 'teilbezahlt'
  else 'offen' end`;

export async function listManualOrders(
  db: Db,
  user: SessionUser,
  opts: { today: string; status?: ManualStatus | "alle" | "aktiv"; search?: string; limit?: number },
): Promise<ManualOrderRow[]> {
  const { rows } = await db.query(
    `select * from (
       select m.order_id, inv.invoice_number, inv.issue_date::text, m.payment_model, o.currency, o.total_gross_cents,
              coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) customer_name, c.email, p.name product,
              (select coalesce(sum(pp.amount_cents), 0) from app.payments pp where pp.order_id = m.order_id and pp.status = 'bezahlt') paid,
              n.due::text next_due, n.gross_cents next_due_cents, u.display_name seller, ${STATUS_SQL} status, inv.number_seq
         from app.manual_orders m
         join app.orders o on o.id = m.order_id
         join app.invoices inv on inv.id = m.invoice_id
         join app.customers c on c.id = o.customer_id
         join app.order_items it on it.order_id = o.id
         join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
         left join app.users u on u.id = o.seller_user_id
         left join lateral (
           select ${DUE} due, i.gross_cents from app.order_installments i
            where i.order_id = m.order_id and i.status in ('offen', 'fehlgeschlagen') order by i.seq limit 1) n on true
        where ($2::boolean or o.seller_user_id = $3)
          and ($4::text is null or inv.invoice_number ilike '%' || $4 || '%' or c.email ilike '%' || $4 || '%' or p.name ilike '%' || $4 || '%'
               or concat_ws(' ', c.first_name, c.last_name, c.company_name) ilike '%' || $4 || '%')
     ) x
     where $5::text = 'alle' or x.status = $5::text
        or ($5::text = 'aktiv' and x.status in ('offen', 'ueberfaellig', 'teilbezahlt', 'rueckzahlung_offen'))
     order by x.number_seq desc
     limit $6`,
    [opts.today, canSeeAll(user), user.id, opts.search?.trim() || null, opts.status ?? "aktiv", opts.limit ?? 200],
  );
  return rows.map((r) => ({
    orderId: r.order_id,
    invoiceNumber: r.invoice_number,
    issueDate: r.issue_date,
    customerName: r.customer_name,
    email: r.email,
    product: r.product,
    model: r.payment_model,
    currency: r.currency,
    totalCents: Number(r.total_gross_cents),
    paidCents: Number(r.paid),
    nextDue: r.next_due,
    nextDueCents: r.next_due_cents === null ? null : Number(r.next_due_cents),
    status: r.status,
    seller: r.seller,
  }));
}

/** Anzahl je Status für die Reiter der Liste. */
export async function countManualOrders(db: Db, user: SessionUser, today: string): Promise<Record<ManualStatus, number>> {
  const { rows } = await db.query<{ status: ManualStatus; n: number }>(
    `select status, count(*)::int n from (
       select ${STATUS_SQL} status from app.manual_orders m join app.orders o on o.id = m.order_id
        where ($2::boolean or o.seller_user_id = $3)) x group by status`,
    [today, canSeeAll(user), user.id],
  );
  const out = { offen: 0, ueberfaellig: 0, teilbezahlt: 0, bezahlt: 0, storniert: 0, rueckzahlung_offen: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function manualOrderDetail(db: Db, user: SessionUser, orderId: string, today: string) {
  const head = (
    await db.query(
      `select m.*, m.pay_by::text pay_by, ${STATUS_SQL} status, o.status order_status, o.currency, o.total_gross_cents, o.created_at order_created_at,
              c.kind customer_kind, c.first_name, c.last_name, c.company_name, c.email, c.street, c.postal_code, c.city, c.country, c.vat_id,
              p.id product_id, p.name product, it.tax_rate_bp, it.tax_note, u.display_name seller, cu.display_name created_by_name,
              cb.display_name cancelled_by_name, rb.display_name refunded_by_name,
              inv.invoice_number, inv.issue_date::text issue_date, inv.note invoice_note, inv.pdf_sha256 is not null invoice_pdf,
              st.invoice_number storno_number, st.issue_date::text storno_date, st.pdf_sha256 is not null storno_pdf
         from app.manual_orders m
         join app.orders o on o.id = m.order_id
         join app.customers c on c.id = o.customer_id
         join app.order_items it on it.order_id = o.id
         join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
         join app.invoices inv on inv.id = m.invoice_id
         join app.users cu on cu.id = m.created_by
         left join app.invoices st on st.id = m.storno_invoice_id
         left join app.users u on u.id = o.seller_user_id
         left join app.users cb on cb.id = m.cancelled_by
         left join app.users rb on rb.id = m.refunded_by
        where m.order_id = $2 and ($3::boolean or o.seller_user_id = $4)`,
      [today, orderId, canSeeAll(user), user.id],
    )
  ).rows[0];
  if (!head) return null;
  const [installments, events, mails] = await Promise.all([
    db.query(
      `select i.id, i.seq, greatest(i.due_date, $2::date)::text due, i.gross_cents, i.status, (p.paid_at at time zone 'Europe/Berlin')::date::text paid_on
         from app.order_installments i left join app.payments p on p.id = i.payment_id
        where i.order_id = $1 order by i.seq`,
      [orderId, head.pay_by],
    ),
    db.query(
      `select e.kind, e.detail, e.created_at, u.display_name from app.manual_order_events e join app.users u on u.id = e.user_id
        where e.order_id = $1 order by e.created_at`,
      [orderId],
    ),
    db.query(
      `select subject, created_at, sent_at, last_error from app.mail_outbox where related_id = any($1::uuid[]) order by created_at`,
      [[head.invoice_id, head.storno_invoice_id].filter(Boolean)],
    ),
  ]);
  return { head, installments: installments.rows, events: events.rows, mails: mails.rows };
}

/** Auswahl für das Formular: Produkte mit bestätigter Steuer, Vertriebspersonen, Bankverbindung vorhanden. */
export async function manualOrderFormData(db: Db) {
  const [products, sellers, bank] = await Promise.all([
    db.query<{ id: string; name: string; active: boolean; tax_category: TaxCategory; prices: string | null }>(
      `select p.id, p.name, p.active, p.tax_category,
              (select string_agg(o.label, ' · ' order by o.label) from app.price_options o where o.product_id = p.id and o.active) prices
         from app.products p where p.tax_confirmed_at is not null
        order by p.active desc, lower(p.name)`,
    ),
    db.query<{ id: string; display_name: string }>(
      `select id, display_name from app.users where active and role in ('admin', 'vertrieb', 'freelancer') order by display_name`,
    ),
    db.query<{ ok: boolean }>(`select bool_and(iban is not null) ok from app.companies`),
  ]);
  return { products: products.rows, sellers: sellers.rows, bankConfigured: bank.rows[0]?.ok === true };
}
