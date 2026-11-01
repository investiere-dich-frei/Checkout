import { paymentSchedule, splitAmount, type PricePlan } from "@idf/core/pricing";
import { decideTax, type TaxCategory, type TaxDecision } from "@idf/core/tax";
import type pg from "pg";
import { canChange, canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";
import { rememberPaymentMethod } from "./billing.ts";
import { manualPriceOption } from "./manual-orders.ts";

/**
 * Übersicht für den Umzug der laufenden Thrivecart-Abos (nur lesen). Ordnet jedes laufende
 * Abo einem Umzugsweg zu, je nachdem, wo die Zahlung technisch liegt:
 *  - PayPal-Abo (I-…): bleibt bei PayPal, der neue Checkout übernimmt nur die Abrechnung.
 *  - Stripe klassisch: Karte liegt im eigenen Stripe-Konto, Umzug ohne Zutun der Kundin.
 *  - ThrivePay: Stripe über Thrivecart; Weg hängt davon ab, wem das Stripe-Konto gehört.
 * Plan: /mnt/project-files/checkout/abo-umzug/plan-abo-umzug.md (Projektablage).
 */

type Db = pg.Pool | pg.ClientBase;

export type TakeoverRoute = "paypal" | "stripe" | "thrivepay" | "unbekannt";

export const RUNNING_STATUSES = ["active", "paused", "overdue", "trial"];

export function takeoverRoute(processor: string | null): TakeoverRoute {
  const p = (processor ?? "").toLowerCase();
  if (p.startsWith("paypal")) return "paypal";
  if (p === "thrivepay") return "thrivepay";
  if (p.startsWith("stripe")) return "stripe";
  return "unbekannt";
}

export interface TakeoverRow {
  subscriptionId: string;
  customerId: string | null;
  email: string;
  product: string | null;
  productMapped: boolean;
  status: string;
  route: TakeoverRoute;
  hasRemoteRef: boolean;
  frequency: string | null;
  amountCents: number | null;
  currency: string;
  paymentsMade: number | null;
  paymentsRemaining: number | null;
  nextPaymentAt: Date | null;
  /** Bestellung im neuen System, wenn schon übernommen. */
  takenOverOrderId: string | null;
  /** Abrechnung in Thrivecart als beendet abgehakt. */
  thrivecartStopped: boolean;
}

export async function takeoverOverview(db: Db, user: SessionUser, opts: { route?: TakeoverRoute } = {}) {
  if (!canSeeAll(user)) return null;
  const { rows } = await db.query(
    `select s.subscription_id::text, s.customer_id, s.email, coalesce(p.name, s.source_row->>'item_name') product,
            s.product_id is not null mapped, lower(s.status) status, s.processor, coalesce(s.remote_subscription_id, '') <> '' has_ref,
            s.frequency, s.amount_cents, coalesce(s.currency, 'EUR') currency, s.payments_made, s.payments_remaining, s.next_payment_at,
            t.order_id taken_over, t.thrivecart_stopped_at is not null stopped
       from legacy.thrivecart_subscriptions s left join app.products p on p.id = s.product_id
       left join app.thrivecart_takeovers t on t.subscription_id = s.subscription_id
      where lower(s.status) = any($1)
      order by s.next_payment_at nulls last, s.subscription_id`,
    [RUNNING_STATUSES],
  );
  const all: TakeoverRow[] = rows.map((r) => ({
    subscriptionId: r.subscription_id,
    customerId: r.customer_id,
    email: r.email,
    product: r.product,
    productMapped: r.mapped,
    status: r.status,
    route: takeoverRoute(r.processor),
    hasRemoteRef: r.has_ref,
    frequency: r.frequency,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    currency: r.currency,
    paymentsMade: r.payments_made,
    paymentsRemaining: r.payments_remaining,
    nextPaymentAt: r.next_payment_at,
    takenOverOrderId: r.taken_over,
    thrivecartStopped: r.stopped ?? false,
  }));
  const routes: TakeoverRoute[] = ["paypal", "stripe", "thrivepay", "unbekannt"];
  const summary = routes.map((route) => {
    const g = all.filter((r) => r.route === route);
    return {
      route,
      count: g.length,
      paused: g.filter((r) => r.status === "paused").length,
      withoutRef: g.filter((r) => !r.hasRemoteRef).length,
      withoutProduct: g.filter((r) => !r.productMapped).length,
      takenOver: g.filter((r) => r.takenOverOrderId).length,
      // Ratenpläne mit höchstens drei offenen Zahlungen können auch in Thrivecart auslaufen.
      endingSoon: g.filter((r) => r.paymentsRemaining !== null && r.paymentsRemaining > 0 && r.paymentsRemaining <= 3).length,
    };
  });
  return { summary, rows: opts.route ? all.filter((r) => r.route === opts.route) : all };
}

// ---------------------------------------------------------------------------
// Übernahme eines einzelnen Abos
// ---------------------------------------------------------------------------

/**
 * Ein laufendes Thrivecart-Abo als Bestellung im neuen System anlegen. Die Bestellung beginnt
 * mit der nächsten Fälligkeit; Betrag und Rhythmus kommen aus Thrivecart (Kundin zahlt weiter
 * dasselbe), der Steuersatz folgt aus dem Produkt und dem Land der Kundin wie bei jedem Kauf.
 * Es entsteht keine Rechnung: Die erste Rechnung im Kreis IDF-n kommt mit der ersten Zahlung.
 *
 *  - Ratenplan (noch n Zahlungen offen): n Fälligkeiten werden festgeschrieben.
 *  - Abo ohne Ende: erste Fälligkeit plus festgeschriebene Bedingungen; weitere legt der
 *    tägliche Lauf an, wie bei eigenen Abos.
 *  - Stripe/ThrivePay: Die gespeicherte Karte der Kundin wird für den Einzug gemerkt.
 *  - PayPal: Das Abo bleibt bei PayPal, es wird nichts eingezogen (Zahlung kommt per Meldung).
 */

export class TakeoverError extends Error {}

/** Thrivecart-Rhythmus in Monaten; wöchentliche oder unbekannte Rhythmen gehen nicht. */
export function intervalMonths(frequency: string | null): number | null {
  const f = (frequency ?? "").trim().toLowerCase();
  const m = /^(\d*)\s*(month|year)s?$/.exec(f);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  return m[2] === "year" ? n * 12 : n;
}

/** Kalendertag in Europe/Berlin (YYYY-MM-DD). */
function berlinDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

export interface TakeoverInput {
  subscriptionId: string;
  /** Heute in Europe/Berlin. */
  today: string;
  /** USt-IdNr. der Kundin geprüft (nur dann Reverse Charge). */
  vatIdVerified?: boolean;
  /** Erste Fälligkeit, wenn der Zahlungsanbieter einen genaueren Tag kennt (Stripe: Ende der Laufzeit). */
  firstDueOn?: string;
  /** Gespeicherte Karte im eigenen Stripe-Konto (bei Stripe und ThrivePay Pflicht). */
  stripe?: { customer: string; paymentMethod: string };
}

export interface TakeoverPreview {
  subscriptionId: string;
  route: "paypal" | "stripe" | "thrivepay";
  remoteSubscriptionId: string;
  customerId: string;
  productId: string;
  productName: string;
  currency: string;
  amountCents: number;
  intervalMonths: number;
  firstDueOn: string;
  remainingPayments: number | null;
  companyId: string;
  buyerCountry: string;
  isBusiness: boolean;
  tax: TaxDecision;
}

interface SubRow {
  subscription_id: string;
  status: string;
  processor: string | null;
  remote_subscription_id: string | null;
  frequency: string | null;
  currency: string | null;
  amount_cents: string | null;
  payments_remaining: number | null;
  next_payment_at: Date | null;
  product_id: string | null;
  product_name: string | null;
  tax_category: TaxCategory | null;
  tax_confirmed_at: Date | null;
  company_id: string | null;
  ch_vat_rate_bp: number | null;
  customer_id: string | null;
  taken_over: string | null;
}

/** Prüfen, ob und wie sich ein Abo übernehmen lässt. Wirft TakeoverError mit einer Meldung für die Verwaltung. */
export async function previewTakeover(db: Db, input: TakeoverInput): Promise<TakeoverPreview> {
  const { rows } = await db.query<SubRow>(
    `select s.subscription_id::text, lower(s.status) status, s.processor, s.remote_subscription_id, s.frequency, s.currency,
            s.amount_cents, s.payments_remaining, s.next_payment_at, s.product_id, p.name product_name, p.tax_category,
            p.tax_confirmed_at, p.company_id, co.ch_vat_rate_bp,
            coalesce(s.customer_id, (select c.id from app.customers c where lower(c.email) = lower(s.email) order by c.created_at desc limit 1)) customer_id,
            t.order_id taken_over
       from legacy.thrivecart_subscriptions s
       left join app.products p on p.id = s.product_id
       left join app.companies co on co.id = p.company_id
       left join app.thrivecart_takeovers t on t.subscription_id = s.subscription_id
      where s.subscription_id::text = $1`,
    [input.subscriptionId],
  );
  const s = rows[0];
  if (!s) throw new TakeoverError("Dieses Thrivecart-Abo gibt es nicht.");
  if (s.taken_over) throw new TakeoverError("Dieses Abo ist schon übernommen.");
  if (s.status !== "active" && s.status !== "trial") {
    throw new TakeoverError("Nur laufende Abos lassen sich übernehmen (nicht pausiert oder überfällig).");
  }
  const route = takeoverRoute(s.processor);
  if (route === "unbekannt") throw new TakeoverError("Zahlungsweg nicht erkannt.");
  const remote = (s.remote_subscription_id ?? "").trim();
  if (!remote) throw new TakeoverError("Zum Abo fehlt die Abo-ID beim Zahlungsanbieter.");
  if (!s.product_id || !s.company_id || !s.tax_category) throw new TakeoverError("Das Abo ist keinem Produkt zugeordnet.");
  if (!s.tax_confirmed_at) throw new TakeoverError("Für das Produkt ist die Steuer noch nicht bestätigt (Verwaltung → Produkte).");
  const months = intervalMonths(s.frequency);
  if (!months) throw new TakeoverError(`Rhythmus „${s.frequency || "unbekannt"}“ lässt sich nicht übernehmen.`);
  const amount = s.amount_cents === null ? 0 : Number(s.amount_cents);
  if (!(amount > 0)) throw new TakeoverError("Betrag der Zahlungen fehlt.");
  if (!s.customer_id) throw new TakeoverError("Zur Kundin gibt es keine Kundendaten.");
  const firstDue = input.firstDueOn ?? (s.next_payment_at ? berlinDay(s.next_payment_at) : null);
  if (!firstDue) throw new TakeoverError("Die nächste Zahlung ist nicht bekannt.");
  if (firstDue <= input.today) throw new TakeoverError("Die nächste Zahlung ist heute oder schon vorbei. Bitte nach der Zahlung übernehmen.");
  if (route !== "paypal" && !input.stripe) throw new TakeoverError("Die gespeicherte Karte bei Stripe fehlt.");

  const c = (
    await db.query<{ kind: string; country: string; vat_id: string | null }>(`select kind, country, vat_id from app.customers where id = $1`, [s.customer_id])
  ).rows[0]!;
  const isBusiness = c.kind === "unternehmen";
  if (isBusiness && c.vat_id && !input.vatIdVerified) {
    throw new TakeoverError("Die Kundin hat eine USt-IdNr. Bitte erst prüfen (Reverse Charge) und dann bestätigen.");
  }
  const tax = decideTax(
    s.tax_category,
    { country: c.country, isBusiness, vatIdVerified: isBusiness && !!input.vatIdVerified && !!c.vat_id },
    { chVatRateBp: s.ch_vat_rate_bp },
  );
  return {
    subscriptionId: s.subscription_id,
    route,
    remoteSubscriptionId: remote,
    customerId: s.customer_id,
    productId: s.product_id,
    productName: s.product_name ?? "",
    currency: (s.currency ?? "EUR").toUpperCase(),
    amountCents: amount,
    intervalMonths: months,
    firstDueOn: firstDue,
    remainingPayments: s.payments_remaining && s.payments_remaining > 0 ? s.payments_remaining : null,
    companyId: s.company_id,
    buyerCountry: c.country.toUpperCase(),
    isBusiness,
    tax,
  };
}

export interface CreatedTakeover {
  orderId: string;
  firstDueOn: string;
  installments: number;
}

export async function createTakeover(client: pg.ClientBase, user: SessionUser, input: TakeoverInput, actor = `user:${user.id}`): Promise<CreatedTakeover> {
  if (!canChange(user)) throw new TakeoverError("Keine Berechtigung");
  // Gleichzeitige Klicks auf dasselbe Abo: der zweite wartet und scheitert dann an „schon übernommen“.
  await client.query(`select pg_advisory_xact_lock(hashtextextended('thrivecart-takeover:' || $1, 0))`, [input.subscriptionId]);
  const p = await previewTakeover(client, input);

  const tax = p.tax;

  const plan: PricePlan = {
    kind: p.remainingPayments ? "raten" : "abo",
    amountCents: p.amountCents,
    recurringAmountCents: p.amountCents,
    recurringCount: p.remainingPayments ? p.remainingPayments - 1 : null,
    intervalMonths: p.intervalMonths,
    trialDays: null,
  };
  const schedule = paymentSchedule(plan, p.firstDueOn, p.remainingPayments ?? 1);
  const parts = schedule.map((x, i) => ({ seq: i + 1, dueDate: x.dueDate, ...splitAmount(x.amountCents, "brutto", tax.rateBp) }));
  const sum = (k: "netCents" | "taxCents" | "grossCents") => parts.reduce((t, x) => t + x[k], 0);

  const legal = await client.query<{ id: string; kind: string }>(
    `select distinct on (kind) id, kind from app.legal_text_versions where valid_from <= now() order by kind, valid_from desc`,
  );
  const legalId = (k: string) => legal.rows.find((r) => r.kind === k)?.id;
  if (!legalId("agb") || !legalId("datenschutz") || !legalId("widerruf")) throw new TakeoverError("Rechtstexte fehlen.");

  const optionId = await manualPriceOption(client, p.productId);
  const orderId = (
    await client.query<{ id: string }>(
      `insert into app.orders (company_id, customer_id, seller_user_id, status, currency, total_gross_cents,
         agb_version_id, privacy_version_id, withdrawal_version_id, buyer_country, buyer_is_business)
       values ($1, $2, null, 'offen', $3, $4, $5, $6, $7, $8, $9) returning id`,
      [p.companyId, p.customerId, p.currency, sum("grossCents"), legalId("agb"), legalId("datenschutz"), legalId("widerruf"), p.buyerCountry, p.isBusiness],
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
  for (const i of parts) {
    await client.query(
      `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, itemId, i.seq, i.dueDate, i.netCents, i.taxCents, i.grossCents],
    );
  }
  if (plan.kind === "abo") {
    await client.query(
      `insert into app.subscription_terms (order_item_id, order_id, plan, purchase_day, amount_basis, tax_rate_bp)
       values ($1, $2, $3, $4, 'brutto', $5)`,
      [itemId, orderId, JSON.stringify(plan), p.firstDueOn, tax.rateBp],
    );
  }
  await client.query(
    `insert into app.thrivecart_takeovers (order_id, subscription_id, route, remote_subscription_id, first_due_on, remaining_payments, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [orderId, p.subscriptionId, p.route, p.remoteSubscriptionId, p.firstDueOn, p.remainingPayments, actor],
  );
  if (input.stripe) {
    await rememberPaymentMethod(client, { customerId: p.customerId, provider: "stripe", ref: input.stripe.paymentMethod, providerCustomer: input.stripe.customer });
  }
  return { orderId, firstDueOn: p.firstDueOn, installments: parts.length };
}

/** In der Verwaltung festhalten, dass die Abrechnung in Thrivecart beendet ist. Einmalig. */
export async function markThrivecartStopped(client: pg.ClientBase, user: SessionUser, orderId: string): Promise<boolean> {
  if (!canChange(user)) throw new TakeoverError("Keine Berechtigung");
  const r = await client.query(
    `update app.thrivecart_takeovers set thrivecart_stopped_at = now(), thrivecart_stopped_by = $2
      where order_id = $1 and thrivecart_stopped_at is null`,
    [orderId, `user:${user.id}`],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Übernahme zur Bestellung, für die Bestellseite. */
export async function takeoverOfOrder(db: Db, orderId: string) {
  const { rows } = await db.query(
    `select subscription_id::text, route, remote_subscription_id, first_due_on::text, remaining_payments, created_at,
            thrivecart_stopped_at
       from app.thrivecart_takeovers where order_id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}
