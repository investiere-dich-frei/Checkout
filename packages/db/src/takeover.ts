import type pg from "pg";
import { canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

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
}

export async function takeoverOverview(db: Db, user: SessionUser, opts: { route?: TakeoverRoute } = {}) {
  if (!canSeeAll(user)) return null;
  const { rows } = await db.query(
    `select s.subscription_id::text, s.customer_id, s.email, coalesce(p.name, s.source_row->>'item_name') product,
            s.product_id is not null mapped, lower(s.status) status, s.processor, coalesce(s.remote_subscription_id, '') <> '' has_ref,
            s.frequency, s.amount_cents, coalesce(s.currency, 'EUR') currency, s.payments_made, s.payments_remaining, s.next_payment_at
       from legacy.thrivecart_subscriptions s left join app.products p on p.id = s.product_id
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
      // Ratenpläne mit höchstens drei offenen Zahlungen können auch in Thrivecart auslaufen.
      endingSoon: g.filter((r) => r.paymentsRemaining !== null && r.paymentsRemaining > 0 && r.paymentsRemaining <= 3).length,
    };
  });
  return { summary, rows: opts.route ? all.filter((r) => r.route === opts.route) : all };
}
