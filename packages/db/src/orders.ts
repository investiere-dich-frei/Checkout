import { paymentSchedule, splitAmount, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import { decideTax, type TaxCategory, type TaxDecision } from "@idf/core/tax";
import type pg from "pg";

/**
 * Bestellung aufgeben: Kunde, Bestellung, Position und Zahlplan entstehen in
 * der Transaktion des Aufrufers, oder gar nicht. Steuer und Fälligkeiten werden
 * dabei festgeschrieben und später nicht mehr neu berechnet.
 */

export interface CustomerInput {
  kind: "privat" | "unternehmen";
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email: string;
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country: string;
  vat_id?: string | null;
}

export interface PlaceOrderInput {
  priceOptionId: string;
  customer: CustomerInput;
  /** USt-IdNr. per VIES geprüft. Nur dann gilt Reverse Charge. */
  vatIdVerified: boolean;
  /** Vertriebsperson aus dem Kauflink; null ohne Vertrieb. */
  sellerUserId: string | null;
  agbVersionId: string;
  privacyVersionId: string;
  withdrawalVersionId: string;
  /** Ausdrückliche Zustimmung zum vorzeitigen Beginn (§ 356 Abs. 5 BGB). */
  withdrawalWaiver: boolean;
  /** Kauftag in Europe/Berlin, YYYY-MM-DD. */
  purchaseDay: string;
}

export interface PlacedOrder {
  orderId: string;
  customerId: string;
  orderItemId: string;
  tax: TaxDecision;
  installments: { seq: number; dueDate: string; netCents: number; taxCents: number; grossCents: number }[];
}

export class OrderError extends Error {}

interface OptionRow {
  price_option_id: string;
  option_active: boolean;
  kind: PricePlan["kind"];
  currency: string;
  amount_cents: string;
  recurring_amount_cents: string | null;
  recurring_count: number | null;
  interval_months: number | null;
  trial_days: number | null;
  amount_basis: AmountBasis;
  product_active: boolean;
  tax_category: TaxCategory;
  company_id: string;
  ch_vat_rate_bp: number | null;
  immediate_access: boolean;
}

export async function placeOrder(client: pg.ClientBase, input: PlaceOrderInput): Promise<PlacedOrder> {
  const { rows } = await client.query<OptionRow>(
    `select o.id price_option_id, o.active option_active, o.kind, o.currency, o.amount_cents,
            o.recurring_amount_cents, o.recurring_count, o.interval_months, o.trial_days, o.amount_basis,
            p.active product_active, p.tax_category, p.company_id, c.ch_vat_rate_bp, p.immediate_access
       from app.price_options o
       join app.products p on p.id = o.product_id
       join app.companies c on c.id = p.company_id
      where o.id = $1`,
    [input.priceOptionId],
  );
  const opt = rows[0];
  if (!opt) throw new OrderError("Preisoption gibt es nicht");
  if (!opt.product_active || !opt.option_active) throw new OrderError("Dieses Angebot ist nicht verkaufbar");

  const legal = await client.query<{ id: string; kind: string }>(
    `select id, kind from app.legal_text_versions where id = any($1::uuid[]) and valid_from <= now()`,
    [[input.agbVersionId, input.privacyVersionId, input.withdrawalVersionId]],
  );
  const kindOf = new Map(legal.rows.map((r) => [r.id, r.kind]));
  if (
    kindOf.get(input.agbVersionId) !== "agb" ||
    kindOf.get(input.privacyVersionId) !== "datenschutz" ||
    kindOf.get(input.withdrawalVersionId) !== "widerruf"
  ) {
    throw new OrderError("Zugestimmte Rechtstexte passen nicht");
  }

  const c = input.customer;
  const isBusiness = c.kind === "unternehmen";
  const tax = decideTax(
    opt.tax_category,
    { country: c.country, isBusiness, vatIdVerified: isBusiness && input.vatIdVerified && !!c.vat_id },
    { chVatRateBp: opt.ch_vat_rate_bp },
  );

  const plan: PricePlan = {
    kind: opt.kind,
    amountCents: Number(opt.amount_cents),
    recurringAmountCents: opt.recurring_amount_cents === null ? null : Number(opt.recurring_amount_cents),
    recurringCount: opt.recurring_count,
    intervalMonths: opt.interval_months,
    trialDays: opt.trial_days,
  };
  // Abos laufen ohne Ende; festgeschrieben wird die erste Fälligkeit, weitere legt die Abrechnung an.
  const schedule = paymentSchedule(plan, input.purchaseDay, plan.kind === "abo" ? 1 : Number.MAX_SAFE_INTEGER);
  if (schedule.length === 0) throw new OrderError("Zahlplan ohne Zahlung");
  const installments = schedule.map((s, i) => {
    const a = splitAmount(s.amountCents, opt.amount_basis, tax.rateBp);
    return { seq: i + 1, dueDate: s.dueDate, netCents: a.netCents, taxCents: a.taxCents, grossCents: a.grossCents };
  });
  const sum = (k: "netCents" | "taxCents" | "grossCents") => installments.reduce((t, x) => t + x[k], 0);

  const customer = await client.query<{ id: string }>(
    `insert into app.customers (kind, first_name, last_name, company_name, email, street, postal_code, city, country, vat_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      c.kind,
      c.first_name ?? null,
      c.last_name ?? null,
      c.company_name ?? null,
      c.email.trim(),
      c.street ?? null,
      c.postal_code ?? null,
      c.city ?? null,
      c.country.toUpperCase(),
      c.vat_id ?? null,
    ],
  );
  const customerId = customer.rows[0]!.id;

  const order = await client.query<{ id: string }>(
    `insert into app.orders (company_id, customer_id, seller_user_id, status, currency, total_gross_cents,
       agb_version_id, privacy_version_id, withdrawal_version_id, withdrawal_waiver_at, buyer_country, buyer_is_business)
     values ($1, $2, $3, 'offen', $4, $5, $6, $7, $8, case when $9 then now() end, $10, $11) returning id`,
    [
      opt.company_id,
      customerId,
      input.sellerUserId,
      opt.currency,
      sum("grossCents"),
      input.agbVersionId,
      input.privacyVersionId,
      input.withdrawalVersionId,
      // Bei Sofortzugang gibt es kein Häkchen, also auch keine Erklärung.
      input.withdrawalWaiver && !opt.immediate_access,
      c.country.toUpperCase(),
      isBusiness,
    ],
  );
  const orderId = order.rows[0]!.id;

  const item = await client.query<{ id: string }>(
    `insert into app.order_items (order_id, price_option_id, quantity, amount_cents, net_cents, tax_cents, gross_cents,
       tax_rate_bp, tax_note, tax_rule, tax_rules_version)
     values ($1, $2, 1, $3, $4, $5, $3, $6, $7, $8, $9) returning id`,
    [orderId, opt.price_option_id, sum("grossCents"), sum("netCents"), sum("taxCents"), tax.rateBp, tax.note, tax.rule, tax.rulesVersion],
  );
  const orderItemId = item.rows[0]!.id;

  for (const i of installments) {
    await client.query(
      `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, orderItemId, i.seq, i.dueDate, i.netCents, i.taxCents, i.grossCents],
    );
  }

  // Abo: Bedingungen festschreiben, damit Verlängerungen nicht vom heutigen Katalog abhängen.
  if (plan.kind === "abo") {
    await client.query(
      `insert into app.subscription_terms (order_item_id, order_id, plan, purchase_day, amount_basis, tax_rate_bp)
       values ($1, $2, $3, $4, $5, $6)`,
      [orderItemId, orderId, JSON.stringify(plan), input.purchaseDay, opt.amount_basis, tax.rateBp],
    );
  }

  return { orderId, customerId, orderItemId, tax, installments };
}
