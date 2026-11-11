import { applyDiscount, discountedPlan, DiscountError } from "@idf/core/discount";
import { paymentSchedule, splitAmount, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import { decideTax, type TaxCategory, type TaxDecision } from "@idf/core/tax";
import type pg from "pg";
import { findCoupon, type ApplicableCoupon } from "./coupons.ts";
import { countryNotAllowed, getCreditSettings, optionCredit, recordCreditContract, usableCheck } from "./credit.ts";
import { CREDIT_TEXTS_VERSION } from "./credit-texts.ts";

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
  /** Gutscheincode aus dem Kaufformular; wird hier erneut geprüft. */
  couponCode?: string | null;
  /**
   * Ratenkauf mit Kredit (Raten über 50 Tage oder mit Aufschlag): Pflicht für Privatkundinnen.
   * checkId ist eine freigegebene Bonitätsprüfung, agreed das Kästchen zum Ratenvertrag,
   * valueCompensation der freiwillige Sofortstart mit Wertersatz.
   */
  credit?: { checkId: string; agreed: boolean; valueCompensation: boolean; shownInformation?: string | null } | null;
  /**
   * Unternehmen ohne geprüfte USt-IdNr. bei Raten, die für Privatkundinnen ein Kredit wären: ausdrückliche
   * Bestätigung, für die gewerbliche oder selbständige Tätigkeit zu kaufen.
   */
  businessPurpose?: boolean;
}

export interface PlacedOrder {
  orderId: string;
  customerId: string;
  orderItemId: string;
  tax: TaxDecision;
  installments: { seq: number; dueDate: string; netCents: number; taxCents: number; grossCents: number }[];
  /** Eingelöster Gutschein mit Rabatt brutto über die festgeschriebenen Fälligkeiten. */
  coupon: { code: string; discountGrossCents: number } | null;
}

export class OrderError extends Error {}
/** Der Gutschein ist nicht (mehr) einlösbar; die Meldung ist für die Kundin geschrieben. */
export class CouponRejected extends OrderError {}
/** Ratenkauf nicht möglich (fehlende oder abgelaufene Prüfung, fehlende Zustimmung); Meldung für die Kundin. */
export class CreditRequired extends OrderError {}

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

  // Verbraucherkreditrecht (§ 506 BGB n. F.) gilt nur für Verbraucher, also Privatkundinnen. Damit niemand als
  // „Unternehmen“ an der Prüfung vorbeikommt, braucht ein Unternehmen bei solchen Raten eine geprüfte USt-IdNr.
  // oder die ausdrückliche Bestätigung, für seine gewerbliche oder selbständige Tätigkeit zu kaufen.
  const optCredit = await optionCredit(client, opt.price_option_id, input.purchaseDay);
  const credit = isBusiness ? null : optCredit;
  let businessPurposeConfirmed = false;
  if (isBusiness && optCredit?.isCredit && !(input.vatIdVerified && c.vat_id)) {
    if (!input.businessPurpose) {
      throw new CreditRequired(
        "Ratenzahlung als Unternehmen bitte mit gültiger USt-IdNr. oder mit der Bestätigung, dass du für deine gewerbliche oder selbständige Tätigkeit kaufst.",
      );
    }
    businessPurposeConfirmed = true;
  }
  let creditCheckId: string | null = null;
  if (credit?.isCredit) {
    if (credit.surchargeCents > 0) throw new CreditRequired("Ratenzahlung mit Aufschlag bieten wir nicht an.");
    const creditSettings = await getCreditSettings(client);
    if (!creditSettings.enabled) throw new CreditRequired("Ratenzahlung ist gerade nicht möglich.");
    const notAllowed = countryNotAllowed(creditSettings, c.country);
    if (notAllowed) throw new CreditRequired(notAllowed);
    const check = input.credit ? await usableCheck(client, input.credit.checkId) : null;
    if (!check || check.priceOptionId !== opt.price_option_id || check.customer.email.trim().toLowerCase() !== c.email.trim().toLowerCase()) {
      throw new CreditRequired("Für die Ratenzahlung fehlt die Prüfung deiner Angaben, oder sie ist abgelaufen.");
    }
    if (!input.credit!.agreed) throw new CreditRequired("Bitte stimme dem Ratenzahlungsvertrag zu.");
    // Lock gegen doppelte Verwendung derselben Prüfung in parallelen Bestellungen (unique credit_check_id fängt den Rest).
    await client.query(`select 1 from app.credit_checks where id = $1 for share`, [check.id]);
    creditCheckId = check.id;
  }
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
  // Gutschein erneut prüfen und für diese Transaktion sperren (Limit bei gleichzeitigen Käufen).
  let coupon: ApplicableCoupon | null = null;
  if (input.couponCode?.trim()) {
    const check = await findCoupon(client, input.couponCode, opt.price_option_id, { lock: true });
    if (!check.ok) throw new CouponRejected(check.message);
    coupon = check.coupon;
  }

  // Abos laufen ohne Ende; festgeschrieben wird die erste Fälligkeit, weitere legt die Abrechnung an.
  const listSchedule = paymentSchedule(plan, input.purchaseDay, plan.kind === "abo" ? 1 : Number.MAX_SAFE_INTEGER);
  if (listSchedule.length === 0) throw new OrderError("Zahlplan ohne Zahlung");
  let schedule = listSchedule.map((s) => ({ ...s, listAmountCents: s.amountCents }));
  let termsPlan = plan;
  if (coupon) {
    try {
      schedule = applyDiscount(listSchedule, coupon.discount);
      termsPlan = discountedPlan(plan, coupon.discount);
    } catch (err) {
      if (err instanceof DiscountError) throw new CouponRejected("Dieser Gutschein gilt nicht für dieses Angebot.");
      throw err;
    }
  }
  const installments = schedule.map((s, i) => {
    const a = splitAmount(s.amountCents, opt.amount_basis, tax.rateBp);
    return { seq: i + 1, dueDate: s.dueDate, netCents: a.netCents, taxCents: a.taxCents, grossCents: a.grossCents };
  });
  const listGross = schedule.reduce((t, s) => t + splitAmount(s.listAmountCents, opt.amount_basis, tax.rateBp).grossCents, 0);
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
       agb_version_id, privacy_version_id, withdrawal_version_id, withdrawal_waiver_at, buyer_country, buyer_is_business,
       credit_check_id, credit_agreement_at, value_compensation_consent_at, credit_texts_version, business_purpose_confirmed_at)
     values ($1, $2, $3, 'offen', $4, $5, $6, $7, $8, case when $9 then now() end, $10, $11,
       $12, case when $12::uuid is not null then now() end, case when $13 then now() end, $14, case when $15 then now() end) returning id`,
    [
      opt.company_id,
      customerId,
      input.sellerUserId,
      opt.currency,
      sum("grossCents"),
      input.agbVersionId,
      input.privacyVersionId,
      input.withdrawalVersionId,
      // Bei Sofortzugang gibt es kein Häkchen, also auch keine Erklärung. Bei Ratenkauf mit Kredit greift
      // § 356 Abs. 5 BGB nicht (§ 312g Abs. 3 BGB); dort gilt stattdessen die Zustimmung zum Wertersatz.
      input.withdrawalWaiver && !opt.immediate_access && !creditCheckId,
      c.country.toUpperCase(),
      isBusiness,
      creditCheckId,
      !!creditCheckId && !!input.credit?.valueCompensation,
      creditCheckId ? CREDIT_TEXTS_VERSION : null,
      businessPurposeConfirmed,
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
      [orderItemId, orderId, JSON.stringify(termsPlan), input.purchaseDay, opt.amount_basis, tax.rateBp],
    );
  }

  let couponResult: PlacedOrder["coupon"] = null;
  if (coupon) {
    const d = coupon.discount;
    const discountGross = listGross - sum("grossCents");
    await client.query(
      `insert into app.order_discounts (order_item_id, order_id, coupon_id, code, kind, percent_bp, amount_cents, scope,
         amount_basis, list_gross_cents, discount_gross_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [orderItemId, orderId, coupon.id, coupon.code, d.kind, d.percentBp, d.amountCents, d.scope, opt.amount_basis, listGross, discountGross],
    );
    couponResult = { code: coupon.code, discountGrossCents: discountGross };
  }

  // Ratenvertrag (Textform) und Erinnerung an das Widerrufsrecht in derselben Transaktion.
  if (creditCheckId) await recordCreditContract(client, orderId, input.purchaseDay, input.credit?.shownInformation ?? null);

  return { orderId, customerId, orderItemId, tax, installments, coupon: couponResult };
}
