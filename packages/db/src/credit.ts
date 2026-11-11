import { createHash } from "node:crypto";
import {
  assessQuestionnaire,
  classifyCredit,
  CREDIT_REMINDER_DAYS,
  creditWithdrawalEnd,
  EMPLOYMENTS,
  QUESTIONNAIRE_RULES_VERSION,
  type CreditAnswers,
  type CreditAssessment,
  type CreditClassification,
  type CreditRules,
  type Employment,
} from "@idf/core/credit";
import { applyDiscount } from "@idf/core/discount";
import { paymentSchedule, splitAmount, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import { decideTax, type TaxCategory } from "@idf/core/tax";
import type pg from "pg";
import { findCoupon } from "./coupons.ts";
import {
  CREDIT_TEXTS_VERSION,
  creditContract,
  creditWithdrawalReminder,
  DEBT_ADVICE,
  precontractInformation,
  type CreditTextData,
} from "./credit-texts.ts";
import { companyFooter, salutation } from "./customer-mails.ts";

/**
 * Ratenkauf mit Kredit: Einordnung der Preisoption, Bonitätsprüfung, Standardinformation,
 * Ratenvertrag und Erinnerung an das Widerrufsrecht. Regeln und Texte: @idf/core/credit und
 * credit-texts.ts; Hintergrund: docs/ratenkauf.md.
 *
 * Die Prüfung ist austauschbar (CreditCheckMethod). Heute gibt es den Fragebogen; eine Auskunftei
 * kommt als weiteres Verfahren dazu, ohne dass sich Checkout oder alte Prüfungen ändern.
 */

type Db = pg.Pool | pg.ClientBase;

export class CreditError extends Error {}

/** Eine Prüfung gilt so lange; danach muss die Kundin neu anfragen. */
export const CHECK_VALID_DAYS = 7;

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

export interface CreditSettings extends CreditRules {
  enabled: boolean;
  contactEmail: string;
  contactPhone: string | null;
  /** Länder (ISO-Code der Anschrift), in denen Ratenkredit angeboten wird; zunächst nur DE. */
  creditCountries: string[];
  updatedAt: Date;
  updatedBy: string;
}

export async function getCreditSettings(db: Db): Promise<CreditSettings> {
  const r = (await db.query(`select * from app.credit_settings where id`)).rows[0];
  if (!r) throw new Error("Einstellungen zum Ratenkauf fehlen (Migration 0034)");
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    enabled: r.enabled,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    creditCountries: r.credit_countries,
    livingCostCents: Number(r.living_cost_cents),
    livingCostPerDependentCents: Number(r.living_cost_per_dependent_cents),
    greenMaxShareBp: r.green_max_share_bp,
    manualReviewFromCents: n(r.manual_review_from_cents),
    bureauFromCents: n(r.bureau_from_cents),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

export function rulesOf(s: CreditRules): CreditRules {
  return {
    livingCostCents: s.livingCostCents,
    livingCostPerDependentCents: s.livingCostPerDependentCents,
    greenMaxShareBp: s.greenMaxShareBp,
    manualReviewFromCents: s.manualReviewFromCents,
    bureauFromCents: s.bureauFromCents,
  };
}

export async function updateCreditSettings(
  client: pg.ClientBase,
  u: Omit<CreditSettings, "updatedAt" | "updatedBy">,
  actor: string,
): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.contactEmail.trim())) throw new CreditError("Bitte eine gültige E-Mail-Adresse für Widerruf und Rückfragen angeben.");
  const cents = (v: number | null, label: string) => {
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw new CreditError(`${label} ist ungültig.`);
    return v;
  };
  const countries = [...new Set(u.creditCountries.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!countries.length || countries.length > 10 || !countries.every((c) => /^[A-Z]{2}$/.test(c))) {
    throw new CreditError("Länder bitte als Kürzel angeben, z. B. „DE“ oder „DE, CH“.");
  }
  if (!Number.isInteger(u.greenMaxShareBp) || u.greenMaxShareBp < 1 || u.greenMaxShareBp > 10000) {
    throw new CreditError("Der Anteil für „grün“ muss zwischen 0,01 und 100 % liegen.");
  }
  await client.query(
    `update app.credit_settings set enabled = $1, contact_email = $2, contact_phone = $3, living_cost_cents = $4,
            living_cost_per_dependent_cents = $5, green_max_share_bp = $6, manual_review_from_cents = $7, bureau_from_cents = $8,
            credit_countries = $10, updated_at = now(), updated_by = $9
      where id`,
    [
      u.enabled,
      u.contactEmail.trim(),
      u.contactPhone?.trim() || null,
      cents(u.livingCostCents, "Lebenshaltung"),
      cents(u.livingCostPerDependentCents, "Zuschlag je Person"),
      u.greenMaxShareBp,
      cents(u.manualReviewFromCents, "Grenze für Prüfung durch das Team"),
      cents(u.bureauFromCents, "Grenze für Auskunftei"),
      actor,
      countries,
    ],
  );
}

/** Meldung, wenn die Anschrift nicht in einem Land liegt, in dem wir Ratenkredit anbieten. */
export function countryNotAllowed(settings: Pick<CreditSettings, "creditCountries">, country: string): string | null {
  if (settings.creditCountries.includes(country.trim().toUpperCase())) return null;
  const names: Record<string, string> = { DE: "Deutschland", AT: "Österreich", CH: "der Schweiz" };
  const list = settings.creditCountries.map((c) => names[c] ?? c);
  const where = list.length > 1 ? `${list.slice(0, -1).join(", ")} oder ${list[list.length - 1]}` : list[0];
  return `Ratenzahlung über mehr als 50 Tage bieten wir derzeit nur bei einer Anschrift in ${where} an. Du kannst mit Einmalzahlung kaufen.`;
}

// ---------------------------------------------------------------------------
// Einordnung einer Preisoption
// ---------------------------------------------------------------------------

export interface OptionCredit extends CreditClassification {
  priceOptionId: string;
  /** Barzahlungspreis: günstigste aktive Einmalzahlung desselben Produkts (gleiche Währung und Preisbasis), sonst der Gesamtpreis. */
  cashPriceCents: number | null;
}

interface OptionData {
  id: string;
  product_id: string;
  kind: PricePlan["kind"];
  currency: string;
  amount_cents: string;
  recurring_amount_cents: string | null;
  recurring_count: number | null;
  interval_months: number | null;
  trial_days: number | null;
  amount_basis: AmountBasis;
  cash_price_cents: string | null;
}

function planOf(o: OptionData): PricePlan {
  return {
    kind: o.kind,
    amountCents: Number(o.amount_cents),
    recurringAmountCents: o.recurring_amount_cents === null ? null : Number(o.recurring_amount_cents),
    recurringCount: o.recurring_count,
    intervalMonths: o.interval_months,
    trialDays: o.trial_days,
  };
}

async function loadOption(db: Db, priceOptionId: string): Promise<OptionData | null> {
  const { rows } = await db.query<OptionData>(
    `select o.id, o.product_id, o.kind, o.currency, o.amount_cents, o.recurring_amount_cents, o.recurring_count, o.interval_months,
            o.trial_days, o.amount_basis,
            (select min(e.amount_cents) from app.price_options e
              where e.product_id = o.product_id and e.kind = 'einmal' and e.active and e.currency = o.currency
                and e.amount_basis = o.amount_basis and e.id <> o.id) cash_price_cents
       from app.price_options o where o.id = $1`,
    [priceOptionId],
  );
  return rows[0] ?? null;
}

/** Ist diese Preisoption ein Kredit? Grundlage für Checkout, Verwaltung und Bestellung. */
export async function optionCredit(db: Db, priceOptionId: string, purchaseDay: string): Promise<OptionCredit | null> {
  const o = await loadOption(db, priceOptionId);
  if (!o) return null;
  const cash = o.cash_price_cents === null ? null : Number(o.cash_price_cents);
  return { priceOptionId, cashPriceCents: cash, ...classifyCredit(planOf(o), purchaseDay, cash) };
}

/** Für Plan-Prüfungen ohne gespeicherte Option (Produktverwaltung). */
export function planCredit(plan: PricePlan, purchaseDay: string, cashPriceCents: number | null): CreditClassification {
  return classifyCredit(plan, purchaseDay, cashPriceCents);
}

// ---------------------------------------------------------------------------
// Fragebogen
// ---------------------------------------------------------------------------

export type AnswerErrors = Partial<Record<keyof CreditAnswers | "confirmed", string>>;

/** Euro-Eingabe wie „2.500“, „2500,50“ in Cent. */
function parseEuro(v: string): number | null {
  const s = v.trim().replace(/\s|€/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Antworten aus dem Formular lesen. Fehlermeldungen sind für die Kundin geschrieben. */
export function parseCreditAnswers(get: (k: string) => string): { ok: true; value: CreditAnswers } | { ok: false; errors: AnswerErrors } {
  const errors: AnswerErrors = {};
  const employment = get("credit_employment") as Employment;
  if (!(employment in EMPLOYMENTS)) errors.employment = "Bitte wähle aus, wie du beschäftigt bist.";
  const money = (key: string, field: keyof CreditAnswers, label: string, required: boolean) => {
    const raw = get(key);
    if (!raw.trim() && !required) return 0;
    const v = parseEuro(raw);
    if (v === null) {
      errors[field] = `Bitte gib ${label} als Betrag in Euro an (0, wenn keine).`;
      return 0;
    }
    return v;
  };
  const netIncomeCents = money("credit_income", "netIncomeCents", "dein monatliches Netto-Einkommen", true);
  const housingCents = money("credit_housing", "housingCents", "deine monatlichen Wohnkosten", true);
  const otherCreditsCents = money("credit_other", "otherCreditsCents", "deine monatlichen anderen Raten", false);
  const dep = get("credit_dependents").trim() || "0";
  const dependents = /^\d{1,2}$/.test(dep) ? Number(dep) : -1;
  if (dependents < 0) errors.dependents = "Bitte gib die Zahl der Personen an (0, wenn niemand).";
  const problems = get("credit_problems");
  if (problems !== "ja" && problems !== "nein") errors.paymentProblems = "Bitte beantworte die Frage zu Zahlungsproblemen.";
  if (get("credit_confirm") !== "on") errors.confirmed = "Bitte bestätige, dass deine Angaben vollständig und richtig sind.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { employment, netIncomeCents, housingCents, otherCreditsCents, dependents, paymentProblems: problems === "ja" } };
}

/** Ein Prüfverfahren. Neue Verfahren (Auskunftei) bekommen einen eigenen Namen und eine eigene Regel-Version. */
export interface CreditCheckMethod {
  name: string;
  rulesVersion: string;
  assess(input: { answers: CreditAnswers; monthlyRateCents: number; creditCents: number; rules: CreditRules }): Promise<CreditAssessment & { bureauResponse?: unknown }>;
}

export const questionnaireMethod: CreditCheckMethod = {
  name: "fragebogen",
  rulesVersion: QUESTIONNAIRE_RULES_VERSION,
  async assess(i) {
    return assessQuestionnaire(i.answers, { monthlyRateCents: i.monthlyRateCents, creditCents: i.creditCents }, i.rules);
  },
};

// ---------------------------------------------------------------------------
// Prüfung anlegen und entscheiden
// ---------------------------------------------------------------------------

export interface CheckCustomer {
  first_name: string;
  last_name: string;
  email: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
}

export interface StartCheckInput {
  priceOptionId: string;
  customer: CheckCustomer;
  answers: CreditAnswers;
  couponCode: string | null;
  sellerUserId: string | null;
  purchaseDay: string;
  /** Adresse der Kaufseite ohne Schrägstrich am Ende, z. B. https://…/kaufen/slug/option. */
  offerUrl: string;
  method?: CreditCheckMethod;
}

export interface CheckOutcome {
  checkId: string;
  result: "gruen" | "gelb" | "rot";
  reasons: string[];
}

/**
 * Bonitätsprüfung durchführen und festschreiben. Bei grün geht die Standardinformation sofort per
 * E-Mail raus (vor dem Vertrag, auf dauerhaftem Datenträger), bei gelb eine Eingangsbestätigung,
 * bei rot die Ablehnung mit Hinweis auf Schuldnerberatung und menschliche Überprüfung.
 */
export async function startCreditCheck(client: pg.ClientBase, input: StartCheckInput): Promise<CheckOutcome> {
  const settings = await getCreditSettings(client);
  if (!settings.enabled) throw new CreditError("Ratenzahlung ist gerade nicht möglich.");
  const credit = await optionCredit(client, input.priceOptionId, input.purchaseDay);
  if (!credit) throw new CreditError("Dieses Angebot gibt es nicht.");
  if (!credit.isCredit) throw new CreditError("Für dieses Angebot ist keine Prüfung nötig.");
  if (credit.surchargeCents > 0) throw new CreditError("Ratenzahlung mit Aufschlag bieten wir nicht an.");
  const notAllowed = countryNotAllowed(settings, input.customer.country);
  if (notAllowed) throw new CreditError(notAllowed);
  const method = input.method ?? questionnaireMethod;
  const rules = rulesOf(settings);
  const assessed = await method.assess({ answers: input.answers, monthlyRateCents: credit.monthlyRateCents, creditCents: credit.creditCents, rules });
  const a = await withEarlierChecks(client, input.customer.email, input.priceOptionId, assessed);

  const { rows } = await client.query<{ id: string }>(
    `insert into app.credit_checks (price_option_id, method, rules_version, rules, customer, email, coupon_code, seller_user_id,
       answers, purchase_day, monthly_rate_cents, credit_cents, free_income_cents, result, reasons, bureau_response, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now() + make_interval(days => $17)) returning id`,
    [
      input.priceOptionId,
      method.name,
      method.rulesVersion,
      JSON.stringify(rules),
      JSON.stringify(input.customer),
      input.customer.email.trim().toLowerCase(),
      input.couponCode,
      input.sellerUserId,
      JSON.stringify(input.answers),
      input.purchaseDay,
      credit.monthlyRateCents,
      credit.creditCents,
      a.freeIncomeCents,
      a.result,
      JSON.stringify(a.reasons),
      a.bureauResponse === undefined ? null : JSON.stringify(a.bureauResponse),
      CHECK_VALID_DAYS,
    ],
  );
  const checkId = rows[0]!.id;
  if (a.result === "gruen") await sendStandardInformation(client, checkId, input.offerUrl);
  else if (a.result === "gelb") await sendCheckMail(client, checkId, "gelb");
  else await sendCheckMail(client, checkId, "rot");
  return { checkId, result: a.result, reasons: a.reasons };
}

/** Zeitraum, in dem frühere Anfragen derselben E-Mail-Adresse zum selben Produkt mitzählen. */
export const EARLIER_CHECKS_DAYS = 30;
/** Ab so vielen früheren Anfragen im Zeitraum entscheidet das Team, auch ohne frühere Ablehnung. */
export const EARLIER_CHECKS_LIMIT = 2;

/**
 * Die Selbstauskunft lässt sich mit anderen Zahlen wiederholen, bis sie „grün“ ergibt. Deshalb wird eine
 * automatische Freigabe zu „gelb“ (Prüfung durch das Team), wenn dieselbe E-Mail-Adresse für dasselbe
 * Produkt in den letzten EARLIER_CHECKS_DAYS Tagen schon abgelehnt wurde oder mehrfach angefragt hat.
 * Rot bleibt rot. Das Team sieht den Grund in der Ratenprüfung.
 */
async function withEarlierChecks<T extends CreditAssessment>(client: pg.ClientBase, email: string, priceOptionId: string, a: T): Promise<T> {
  if (a.result !== "gruen") return a;
  const { rows } = await client.query<{ n: string; rejected: string }>(
    `select count(*) n,
            count(*) filter (where c.result = 'rot' or d.decision = 'abgelehnt') rejected
       from app.credit_checks c
       join app.price_options o on o.id = c.price_option_id
       left join app.credit_check_decisions d on d.credit_check_id = c.id
      where c.email = $1
        and o.product_id = (select product_id from app.price_options where id = $2)
        and c.created_at > now() - make_interval(days => $3)`,
    [email.trim().toLowerCase(), priceOptionId, EARLIER_CHECKS_DAYS],
  );
  const n = Number(rows[0]?.n ?? 0);
  const rejected = Number(rows[0]?.rejected ?? 0);
  const reasons: string[] = [];
  if (rejected > 0) reasons.push(`Für diese E-Mail-Adresse wurde eine Ratenzahlung für dieses Produkt in den letzten ${EARLIER_CHECKS_DAYS} Tagen schon abgelehnt.`);
  else if (n >= EARLIER_CHECKS_LIMIT) reasons.push(`Diese E-Mail-Adresse hat in den letzten ${EARLIER_CHECKS_DAYS} Tagen schon ${n} Anfragen für dieses Produkt gestellt.`);
  if (!reasons.length) return a;
  return { ...a, result: "gelb", reasons };
}

/** Entscheidung des Teams zu einer Prüfung (gelb, oder rot auf Wunsch der Kundin nach menschlicher Überprüfung). */
export async function decideCreditCheck(
  client: pg.ClientBase,
  checkId: string,
  decision: "freigegeben" | "abgelehnt",
  note: string,
  actor: string,
  offerUrl: string,
): Promise<void> {
  if (!note.trim()) throw new CreditError("Bitte eine kurze Begründung angeben.");
  const c = (await client.query(`select result, expires_at < now() expired from app.credit_checks where id = $1 for update`, [checkId])).rows[0];
  if (!c) throw new CreditError("Diese Prüfung gibt es nicht.");
  if (c.result === "gruen") throw new CreditError("Diese Prüfung ist bereits automatisch freigegeben.");
  const used = await client.query(`select 1 from app.credit_check_decisions where credit_check_id = $1`, [checkId]);
  if (used.rowCount) throw new CreditError("Zu dieser Prüfung gibt es schon eine Entscheidung.");
  await client.query(`insert into app.credit_check_decisions (credit_check_id, decision, note, decided_by) values ($1, $2, $3, $4)`, [
    checkId,
    decision,
    note.trim(),
    actor,
  ]);
  if (decision === "freigegeben") await sendStandardInformation(client, checkId, offerUrl, { extendFromNow: !!c.expired });
  else await sendCheckMail(client, checkId, "abgelehnt");
}

export interface UsableCheck {
  id: string;
  priceOptionId: string;
  customer: CheckCustomer;
  couponCode: string | null;
  sellerUserId: string | null;
  purchaseDay: string;
  standardInformation: string;
}

/**
 * Prüfung, mit der jetzt bestellt werden darf: grün oder freigegeben, nicht abgelaufen, noch nicht
 * verwendet. Abgelaufen zählt ab der Freigabe, wenn das Team später entschieden hat.
 */
export async function usableCheck(db: Db, checkId: string): Promise<UsableCheck | null> {
  if (!/^[0-9a-f-]{36}$/i.test(checkId)) return null;
  const { rows } = await db.query(
    `select c.id, c.price_option_id, c.customer, c.coupon_code, c.seller_user_id, c.purchase_day::text purchase_day,
            (select content from app.credit_documents d where d.credit_check_id = c.id and d.kind = 'standardinformation'
              order by d.created_at desc limit 1) standard_information
       from app.credit_checks c
       left join app.credit_check_decisions dec on dec.credit_check_id = c.id
      where c.id = $1
        and (c.result = 'gruen' or dec.decision = 'freigegeben')
        and greatest(c.expires_at, dec.decided_at + make_interval(days => $2)) > now()
        and not exists (select 1 from app.orders o where o.credit_check_id = c.id)`,
    [checkId, CHECK_VALID_DAYS],
  );
  const r = rows[0];
  if (!r || !r.standard_information) return null;
  return {
    id: r.id,
    priceOptionId: r.price_option_id,
    customer: r.customer,
    couponCode: r.coupon_code,
    sellerUserId: r.seller_user_id,
    purchaseDay: r.purchase_day,
    standardInformation: r.standard_information,
  };
}

// ---------------------------------------------------------------------------
// Texte und E-Mails
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Daten für die Rechtstexte: Zahlplan wie bei der Bestellung (gleiche Rechenwege, inklusive Gutschein),
 * immer für Privatkundinnen, denn nur für Verbraucher gilt das Kreditrecht.
 */
export async function creditTextData(
  db: Db,
  i: { priceOptionId: string; customer: CheckCustomer; couponCode: string | null; contractDay: string },
): Promise<CreditTextData> {
  const { rows } = await db.query(
    `select o.label, o.currency, o.amount_basis, p.name product, p.tax_category, c.ch_vat_rate_bp,
            c.legal_name, c.street, c.postal_code, c.city, c.register_info
       from app.price_options o join app.products p on p.id = o.product_id join app.companies c on c.id = p.company_id
      where o.id = $1`,
    [i.priceOptionId],
  );
  const r = rows[0];
  const opt = await loadOption(db, i.priceOptionId);
  if (!r || !opt) throw new CreditError("Dieses Angebot gibt es nicht.");
  const settings = await getCreditSettings(db);
  const tax = decideTax(r.tax_category as TaxCategory, { country: i.customer.country, isBusiness: false, vatIdVerified: false }, { chVatRateBp: r.ch_vat_rate_bp });
  const plan = planOf(opt);
  let schedule = paymentSchedule(plan, i.contractDay, Number.MAX_SAFE_INTEGER);
  if (i.couponCode) {
    const check = await findCoupon(db, i.couponCode, i.priceOptionId);
    if (check.ok) schedule = applyDiscount(schedule, check.coupon.discount);
  }
  const gross = (cents: number) => splitAmount(cents, r.amount_basis, tax.rateBp).grossCents;
  const total = schedule.reduce((t, s) => t + gross(s.amountCents), 0);
  // Barzahlungspreis: Einmalzahlung desselben Produkts; ohne Gutschein-Rabatt, der gilt nur für diesen Plan.
  const cash = opt.cash_price_cents === null ? total : Math.min(gross(Number(opt.cash_price_cents)), total);
  const percent = (bp: number) => `${(bp / 100).toLocaleString("de-DE")} %`;
  return {
    company: {
      legalName: r.legal_name,
      street: r.street,
      postalCode: r.postal_code,
      city: r.city,
      email: settings.contactEmail,
      phone: settings.contactPhone,
      registerInfo: r.register_info,
    },
    customer: {
      name: `${i.customer.first_name} ${i.customer.last_name}`.trim(),
      street: i.customer.street,
      postalCode: i.customer.postal_code,
      city: i.customer.city,
      email: i.customer.email,
    },
    product: r.product,
    optionLabel: r.label,
    currency: r.currency,
    cashPriceCents: cash,
    schedule: schedule.map((s) => ({ dueDate: s.dueDate, grossCents: gross(s.amountCents) })),
    contractDay: i.contractDay,
    taxNote: tax.rateBp > 0 ? `inkl. ${percent(tax.rateBp)} Umsatzsteuer` : tax.note ?? "ohne Umsatzsteuer",
  };
}

async function checkRow(client: pg.ClientBase, checkId: string) {
  const r = (
    await client.query(
      `select c.*, c.purchase_day::text purchase_day_text, co.legal_name, co.street, co.postal_code, co.city, co.vat_id, co.register_info, p.name product
         from app.credit_checks c
         join app.price_options o on o.id = c.price_option_id join app.products p on p.id = o.product_id
         join app.companies co on co.id = p.company_id
        where c.id = $1`,
      [checkId],
    )
  ).rows[0];
  if (!r) throw new CreditError("Diese Prüfung gibt es nicht.");
  return r;
}

async function enqueue(client: pg.ClientBase, to: string, subject: string, body: string, relatedId: string, delayDays = 0): Promise<void> {
  await client.query(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id, next_attempt_at)
     values ('ratenkauf', $1, $2, $3, $4, now() + make_interval(days => $5))`,
    [to, subject, body, relatedId, delayDays],
  );
}

/** Standardinformation festschreiben und per E-Mail schicken, mit Link zum zweiten Schritt. */
async function sendStandardInformation(client: pg.ClientBase, checkId: string, offerUrl: string, _opts: { extendFromNow?: boolean } = {}): Promise<void> {
  const c = await checkRow(client, checkId);
  const today = (await client.query<{ d: string }>(`select (now() at time zone 'Europe/Berlin')::date::text d`)).rows[0]!.d;
  const data = await creditTextData(client, { priceOptionId: c.price_option_id, customer: c.customer, couponCode: c.coupon_code, contractDay: today });
  const text = precontractInformation(data);
  await client.query(
    `insert into app.credit_documents (credit_check_id, kind, version, content, sha256) values ($1, 'standardinformation', $2, $3, $4)`,
    [checkId, CREDIT_TEXTS_VERSION, text, sha256(text)],
  );
  const link = `${offerUrl}/raten/${checkId}`;
  const body = [
    salutation(c.customer),
    "",
    `deine Ratenzahlung für „${c.product}“ ist möglich. Bevor du den Ratenvertrag abschließt, bekommst du hier die vorgeschriebenen Informationen dazu. Bitte lies sie in Ruhe.`,
    "",
    `Zum Abschluss deiner Bestellung: ${link}`,
    `Der Link gilt ${CHECK_VALID_DAYS} Tage.`,
    "",
    "----------------------------------------",
    text,
    "----------------------------------------",
    "",
    companyFooter(c),
  ].join("\n");
  await enqueue(client, c.email, `Informationen zu deiner Ratenzahlung: ${c.product}`, body, checkId);
}

async function sendCheckMail(client: pg.ClientBase, checkId: string, kind: "gelb" | "rot" | "abgelehnt"): Promise<void> {
  const c = await checkRow(client, checkId);
  const contact = (await getCreditSettings(client)).contactEmail;
  const body =
    kind === "gelb"
      ? [
          salutation(c.customer),
          "",
          `danke für deine Anfrage zur Ratenzahlung für „${c.product}“. Wir schauen uns deine Angaben persönlich an und melden uns spätestens am nächsten Werktag bei dir.`,
        ]
      : [
          salutation(c.customer),
          "",
          `leider können wir dir für „${c.product}“ keine Ratenzahlung anbieten. Das haben wir anhand deiner Angaben im Fragebogen entschieden${kind === "abgelehnt" ? ", nachdem wir sie persönlich geprüft haben" : " (automatische Auswertung)"}.`,
          "",
          "Du kannst das Angebot weiterhin mit Einmalzahlung kaufen. Wenn du meinst, dass wir etwas falsch eingeschätzt haben, antworte einfach auf diese E-Mail oder schreib an " +
            contact +
            ". Dann prüft ein Mensch aus unserem Team deine Anfrage und erklärt dir die Entscheidung.",
          "",
          DEBT_ADVICE,
        ];
  body.push("", companyFooter(c));
  await enqueue(client, c.email, kind === "gelb" ? `Deine Anfrage zur Ratenzahlung: ${c.product}` : `Deine Anfrage zur Ratenzahlung: ${c.product}`, body.join("\n"), checkId);
}

/**
 * Nach der Bestellung: Ratenvertrag festschreiben und per E-Mail schicken (Textform), Erinnerung an das
 * Widerrufsrecht für Tag CREDIT_REMINDER_DAYS vormerken. Läuft in der Transaktion der Bestellung.
 */
export async function recordCreditContract(client: pg.ClientBase, orderId: string, contractDay: string): Promise<void> {
  const o = (
    await client.query(
      `select o.id, o.credit_check_id, o.value_compensation_consent_at is not null value_compensation,
              cu.email, cu.first_name, cu.last_name, cu.company_name, cu.street, cu.postal_code, cu.city, cu.country,
              co.legal_name, co.street co_street, co.postal_code co_postal_code, co.city co_city, co.vat_id, co.register_info,
              it.price_option_id, p.name product, o.currency
         from app.orders o join app.customers cu on cu.id = o.customer_id join app.companies co on co.id = o.company_id
         join app.order_items it on it.order_id = o.id join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
        where o.id = $1`,
      [orderId],
    )
  ).rows[0];
  if (!o?.credit_check_id) throw new CreditError("Bestellung ohne Ratenvertrag");
  const data = await creditTextData(client, {
    priceOptionId: o.price_option_id,
    customer: o,
    couponCode: null,
    contractDay,
  });
  // Zahlplan aus der Bestellung (festgeschrieben, mit Gutschein), nicht neu gerechnet.
  const inst = await client.query<{ due_date: string; gross_cents: string }>(
    `select due_date::text, gross_cents from app.order_installments where order_id = $1 order by seq`,
    [orderId],
  );
  data.schedule = inst.rows.map((r) => ({ dueDate: r.due_date, grossCents: Number(r.gross_cents) }));
  data.cashPriceCents = Math.min(data.cashPriceCents, data.schedule.reduce((t, s) => t + s.grossCents, 0));
  const text = creditContract(data, { orderNumber: orderId, valueCompensation: o.value_compensation });
  await client.query(
    `insert into app.credit_documents (credit_check_id, order_id, kind, version, content, sha256) values ($1, $2, 'ratenvertrag', $3, $4, $5)`,
    [o.credit_check_id, orderId, CREDIT_TEXTS_VERSION, text, sha256(text)],
  );
  const footer = companyFooter({ legal_name: o.legal_name, street: o.co_street, postal_code: o.co_postal_code, city: o.co_city, vat_id: o.vat_id, register_info: o.register_info });
  const to = String(o.email).trim().toLowerCase();
  await enqueue(
    client,
    to,
    `Dein Ratenzahlungsvertrag: ${o.product}`,
    [salutation(o), "", "hier ist dein Ratenzahlungsvertrag mit allen Angaben. Bitte bewahre diese E-Mail auf.", "", text, "", footer].join("\n"),
    orderId,
  );
  await enqueue(
    client,
    to,
    `Erinnerung: dein Widerrufsrecht für ${o.product}`,
    [salutation(o), "", creditWithdrawalReminder(data, creditWithdrawalEnd(contractDay)), "", footer].join("\n"),
    orderId,
    CREDIT_REMINDER_DAYS,
  );
}

/** Für die Verwaltung: Prüfungen, offene (gelb ohne Entscheidung) zuerst. */
export async function listCreditChecks(db: Db, limit = 100) {
  const { rows } = await db.query(
    `select c.id, c.created_at, c.email, c.customer, c.result, c.reasons, c.answers, c.method, c.rules_version,
            c.monthly_rate_cents, c.credit_cents, c.free_income_cents, c.expires_at, p.name product, o.label option_label,
            d.decision, d.note, d.decided_by, d.decided_at,
            (select ord.id from app.orders ord where ord.credit_check_id = c.id) order_id
       from app.credit_checks c
       join app.price_options o on o.id = c.price_option_id join app.products p on p.id = o.product_id
       left join app.credit_check_decisions d on d.credit_check_id = c.id
      order by (c.result = 'gelb' and d.id is null) desc, c.created_at desc
      limit $1`,
    [limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Schwärzen nach Ablauf der Aufbewahrung (Entscheidung Christian vom 11.11.2026)
// ---------------------------------------------------------------------------

/** Prüfungen ohne Bestellung (abgelehnt, abgelaufen, nicht genutzt): Antworten nach so vielen Monaten schwärzen. */
export const REDACT_UNUSED_AFTER_MONTHS = 6;
/** Prüfungen mit Ratenvertrag: Antworten so viele Jahre nach der letzten Rate schwärzen (regelmäßige Verjährung). */
export const REDACT_CONTRACT_AFTER_YEARS = 3;

/**
 * Schwärzt Fragebogen-Antworten, Kundenangaben und E-Mail-Adresse abgelaufener Prüfungen. Ergebnis, Regeln,
 * Beträge und Begründungen bleiben als Nachweis der Prüfung stehen. Läuft täglich mit dem Einzug.
 * Gibt die Zahl der geschwärzten Prüfungen zurück.
 */
export async function redactExpiredCreditChecks(client: pg.ClientBase): Promise<number> {
  const r = await client.query(
    `update app.credit_checks c
        set redacted_at = now(), answers = '{}'::jsonb, customer = '{}'::jsonb, email = 'geschwärzt',
            free_income_cents = null, bureau_response = null
      where c.redacted_at is null
        and case
              when exists (select 1 from app.orders o where o.credit_check_id = c.id)
                then coalesce((select max(i.due_date) from app.orders o join app.order_installments i on i.order_id = o.id
                                where o.credit_check_id = c.id), c.created_at::date)
                     + make_interval(years => $2) < now()
              else c.created_at + make_interval(months => $1) < now()
            end`,
    [REDACT_UNUSED_AFTER_MONTHS, REDACT_CONTRACT_AFTER_YEARS],
  );
  return r.rowCount ?? 0;
}
