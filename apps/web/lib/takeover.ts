import type { SessionUser } from "@idf/db/auth";
import { paypalAmountToCents } from "@idf/db/paypal";
import {
  createTakeover,
  handlePaypalAboPayment,
  paypalAbosToSync,
  previewTakeover,
  TakeoverError,
  type CreatedTakeover,
  type PaypalAboPayment,
} from "@idf/db/takeover";
import type pg from "pg";
import type Stripe from "stripe";
import type { PaypalApi, PaypalSale, PaypalSubscriptionTransaction } from "./paypal";

/**
 * Abo-Umzug aus Thrivecart, Teil Stripe (Stripe klassisch und ThrivePay). Das Abo, die Karte und
 * der Stripe-Kunde liegen im eigenen Stripe-Konto. Ablauf in einer Transaktion:
 *  1. Stripe-Abo lesen: Kunde, gespeicherte Karte, Ende der laufenden Periode (= erste Fälligkeit bei uns).
 *  2. Bestellung im neuen System anlegen und die Karte für den Einzug merken.
 *  3. Stripe-Abo zum Ende der Periode kündigen, damit nicht doppelt abgebucht wird.
 * Scheitert 3., wird 2. zurückgerollt. Die Zahlungsdaten bleiben unverändert bei Stripe.
 *
 * PayPal-Abos: siehe takeOverPaypalSubscription und syncPaypalAbos weiter unten.
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
  if (first.route === "paypal") throw new TakeoverError("Das ist ein PayPal-Abo.");
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

async function inTx<T>(pool: pg.Pool, actor: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', $1, true)`, [actor]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * PayPal-Abo übernehmen. Das Abo bleibt bei PayPal und bucht weiter selbst ab; bei uns entsteht die
 * Bestellung ab der nächsten Abbuchung laut PayPal. Die Zahlungen verbucht syncPaypalAbos
 * (täglicher Lauf) bzw. die PayPal-Meldung. In Thrivecart danach nur die Abrechnung beenden,
 * nie „Cancel“: Das würde das PayPal-Abo mitkündigen.
 */
export async function takeOverPaypalSubscription(
  pool: pg.Pool,
  api: PaypalApi,
  user: SessionUser,
  input: { subscriptionId: string; today: string; vatIdVerified?: boolean },
): Promise<CreatedTakeover> {
  const first = await previewTakeover(pool, input);
  if (first.route !== "paypal") throw new TakeoverError("Das ist kein PayPal-Abo.");
  let sub;
  try {
    sub = await api.getSubscription(first.remoteSubscriptionId);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403) throw new TakeoverError("Das PayPal-Abo ist mit dem PayPal-Zugang der Kasse nicht zu lesen (anderes Konto?).");
    throw err;
  }
  if (sub.status !== "ACTIVE") throw new TakeoverError(`Das PayPal-Abo ist nicht aktiv (${sub.status}).`);
  const next = sub.billing_info?.next_billing_time;
  if (!next) throw new TakeoverError("PayPal nennt keine nächste Abbuchung.");
  const firstDueOn = berlinDay(Date.parse(next) / 1000);
  return inTx(pool, `user:${user.id}`, (c) => createTakeover(c, user, { ...input, firstDueOn }));
}

const toPayment = (t: PaypalSubscriptionTransaction, subscriptionId: string, live: boolean): PaypalAboPayment | null => {
  const g = t.amount_with_breakdown?.gross_amount;
  if (!g || !t.time) return null;
  return {
    subscriptionId,
    transactionId: t.id,
    status: t.status,
    amountCents: paypalAmountToCents(g.value),
    currency: g.currency_code,
    paidAt: new Date(t.time),
    live,
    source: "abfrage",
  };
};

/** Webhook PAYMENT.SALE.* eines PayPal-Abos in eine Zahlung übersetzen, sonst null. */
export function aboPaymentFromSale(eventType: string, sale: PaypalSale | null | undefined, live: boolean): PaypalAboPayment | null {
  if (!eventType.startsWith("PAYMENT.SALE.") || !sale?.billing_agreement_id?.startsWith("I-")) return null;
  return {
    subscriptionId: sale.billing_agreement_id,
    transactionId: sale.id,
    status: sale.state === "completed" ? "COMPLETED" : sale.state.toUpperCase(),
    amountCents: paypalAmountToCents(sale.amount.total),
    currency: sale.amount.currency,
    paidAt: sale.create_time ? new Date(sale.create_time) : new Date(),
    live,
    source: "webhook",
  };
}

export interface PaypalAboSync {
  abos: number;
  booked: number;
  review: number;
  errors: number;
}

/**
 * Täglich: Für jedes übernommene PayPal-Abo mit fälliger, offener Zahlung bei PayPal nachsehen
 * und abgeschlossene Zahlungen verbuchen. Fängt auch Zahlungen auf, deren Meldung nie ankam.
 */
export async function syncPaypalAbos(pool: pg.Pool, api: PaypalApi, today: string, live: boolean, now = new Date()): Promise<PaypalAboSync> {
  const run: PaypalAboSync = { abos: 0, booked: 0, review: 0, errors: 0 };
  for (const a of await paypalAbosToSync(pool, today)) {
    run.abos++;
    try {
      const txns = await api.subscriptionTransactions(a.subscriptionId, new Date(`${a.from}T00:00:00Z`), now);
      const payments = txns
        .map((t) => toPayment(t, a.subscriptionId, live))
        .filter((p): p is PaypalAboPayment => p !== null)
        .sort((x, y) => x.paidAt.getTime() - y.paidAt.getTime());
      for (const p of payments) {
        const h = await inTx(pool, "system:paypal-abo", (c) => handlePaypalAboPayment(c, p));
        if (!h.firstDelivery) continue;
        if (h.outcome === "gebucht") run.booked++;
        if (h.outcome === "pruefen") {
          run.review++;
          console.error(`PayPal-Abozahlung nicht verbucht, bitte prüfen: ${p.transactionId} (${h.note ?? "ohne Hinweis"})`);
        }
      }
    } catch (err) {
      console.error(`PayPal-Abo ${a.subscriptionId} nicht abgefragt:`, (err as Error).message);
      run.errors++;
    }
  }
  return run;
}
