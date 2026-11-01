import type { SessionUser } from "@idf/db/auth";
import { createTakeover, previewTakeover, TakeoverError, type CreatedTakeover } from "@idf/db/takeover";
import type pg from "pg";
import type Stripe from "stripe";

/**
 * Abo-Umzug aus Thrivecart, Teil Stripe (Stripe klassisch und ThrivePay). Das Abo, die Karte und
 * der Stripe-Kunde liegen im eigenen Stripe-Konto. Ablauf in einer Transaktion:
 *  1. Stripe-Abo lesen: Kunde, gespeicherte Karte, Ende der laufenden Periode (= erste Fälligkeit bei uns).
 *  2. Bestellung im neuen System anlegen und die Karte für den Einzug merken.
 *  3. Stripe-Abo zum Ende der Periode kündigen, damit nicht doppelt abgebucht wird.
 * Scheitert 3., wird 2. zurückgerollt. Die Zahlungsdaten bleiben unverändert bei Stripe.
 *
 * PayPal-Abos sind noch gesperrt, bis deren Zahlungen per PayPal-Meldung verbucht werden.
 */

export interface StripeSource {
  customer: string;
  paymentMethod: string;
  /** Ende der laufenden Periode als Kalendertag in Europe/Berlin. */
  periodEnd: string;
}

const berlinDay = (unix: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(unix * 1000));

/** Kunde, Karte und Periodenende eines Stripe-Abos. Wirft TakeoverError mit Meldung für die Verwaltung. */
export async function stripeSource(api: Stripe, subscriptionId: string): Promise<StripeSource> {
  let sub: Stripe.Subscription;
  try {
    sub = await api.subscriptions.retrieve(subscriptionId, { expand: ["customer"] });
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") {
      throw new TakeoverError("Das Stripe-Abo ist im verbundenen Stripe-Konto nicht zu finden (anderes Konto?).");
    }
    throw err;
  }
  if (sub.status !== "active" && sub.status !== "trialing") throw new TakeoverError(`Das Stripe-Abo ist nicht aktiv (${sub.status}).`);
  // Gekündigt durch einen früheren, abgebrochenen Versuch von uns: dann weiter, sonst nicht.
  const ours = !!sub.metadata?.idf_takeover_order_id;
  if ((sub.cancel_at_period_end || sub.cancel_at) && !ours) throw new TakeoverError("Das Stripe-Abo ist schon gekündigt.");
  const customer = typeof sub.customer === "string" ? null : sub.customer;
  if (!customer || customer.deleted) throw new TakeoverError("Zum Stripe-Abo gibt es keinen Stripe-Kunden.");
  const pm = sub.default_payment_method ?? customer.invoice_settings?.default_payment_method ?? null;
  const paymentMethod = typeof pm === "string" ? pm : pm?.id;
  if (!paymentMethod) throw new TakeoverError("Beim Stripe-Kunden ist keine Karte als Standard hinterlegt.");
  // Seit API 2025-03 steht das Periodenende an den Positionen.
  const ends = sub.items.data.map((i) => i.current_period_end).filter((x): x is number => typeof x === "number");
  if (ends.length === 0) throw new TakeoverError("Das Ende der laufenden Periode ist bei Stripe nicht bekannt.");
  return { customer: customer.id, paymentMethod, periodEnd: berlinDay(Math.min(...ends)) };
}

export async function takeOverStripeSubscription(
  pool: pg.Pool,
  api: Stripe,
  user: SessionUser,
  input: { subscriptionId: string; today: string; vatIdVerified?: boolean },
): Promise<CreatedTakeover> {
  // Vorab ohne Stripe prüfen, damit offensichtliche Hindernisse nicht erst Stripe fragen.
  const first = await previewTakeover(pool, { ...input, stripe: { customer: "-", paymentMethod: "-" } });
  if (first.route === "paypal") throw new TakeoverError("PayPal-Abos lassen sich noch nicht übernehmen.");
  const remote = first.remoteSubscriptionId;
  if (!remote.startsWith("sub_")) throw new TakeoverError("Die Abo-ID ist keine Stripe-Abo-ID.");
  const src = await stripeSource(api, remote);

  const actor = `user:${user.id}`;
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', $1, true)`, [actor]);
    const created = await createTakeover(c, user, {
      ...input,
      firstDueOn: src.periodEnd,
      stripe: { customer: src.customer, paymentMethod: src.paymentMethod },
    });
    await api.subscriptions.update(
      remote,
      { cancel_at_period_end: true, metadata: { idf_takeover_order_id: created.orderId } },
      { idempotencyKey: `uebernahme-${input.subscriptionId}-${created.orderId}` },
    );
    await c.query("commit");
    return created;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
