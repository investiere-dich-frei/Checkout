import {
  cardSetupTarget,
  nextPaymentTarget,
  rememberCardSetup,
  rememberPaymentIntent,
  rememberStripeCustomer,
  type CardSetupTarget,
  type PaymentTarget,
} from "@idf/db/stripe";
import type Stripe from "stripe";
import { pool, transaction } from "./db";
import { todayBerlin } from "./format";

export type PreparedPayment =
  /** Jetzt ist nichts fällig; spätere Raten werden zum Fälligkeitstag eingezogen. */
  | { state: "nichts_faellig" }
  /** Probezeit ohne Anzahlung: Heute wird nichts abgebucht, die Kundin hinterlegt nur ihre Karte. */
  | { state: "karte_hinterlegen"; setup: CardSetupTarget; clientSecret: string }
  | { state: "nicht_eingerichtet"; target: PaymentTarget }
  | { state: "bereit"; target: PaymentTarget; clientSecret: string }
  /** Zahlung läuft oder ist bei Stripe eingegangen; die Bestätigung von Stripe steht noch aus. */
  | { state: "in_bearbeitung"; target: PaymentTarget };

// Diese Zustände kann die Kundin noch abschließen; dann wird dieselbe Zahlungsabsicht wieder verwendet.
const REUSABLE: Stripe.PaymentIntent.Status[] = ["requires_payment_method", "requires_confirmation", "requires_action"];

/**
 * Zahlung für die nächste fällige Rate vorbereiten. Legt bei Bedarf den
 * Stripe-Kunden und die Zahlungsabsicht an und merkt sich beide. Beim Neuladen
 * der Seite entsteht so keine zweite Zahlungsabsicht.
 */
export async function preparePayment(api: Stripe | null, orderId: string): Promise<PreparedPayment> {
  const target = await nextPaymentTarget(pool(), orderId, todayBerlin());
  if (!target) return api ? prepareCardSetup(api, orderId) : { state: "nichts_faellig" };
  if (!api) return { state: "nicht_eingerichtet", target };

  if (target.paymentIntentId) {
    const existing = await api.paymentIntents.retrieve(target.paymentIntentId);
    if (existing.status === "processing" || existing.status === "succeeded") return { state: "in_bearbeitung", target };
    if (REUSABLE.includes(existing.status) && existing.amount === target.grossCents && existing.client_secret) {
      return { state: "bereit", target, clientSecret: existing.client_secret };
    }
  }

  const customer = await ensureStripeCustomer(api, target);

  const intent = await api.paymentIntents.create(
    {
      amount: target.grossCents,
      currency: target.currency.toLowerCase(),
      customer,
      automatic_payment_methods: { enabled: true },
      // Bei Raten und Abos wird die Zahlungsart für die folgenden Fälligkeiten gespeichert.
      ...(target.recurring ? { setup_future_usage: "off_session" as const } : {}),
      metadata: { installment_id: target.installmentId, order_id: target.orderId, seq: String(target.seq) },
    },
    // Je Fälligkeit und Vorgänger eine Absicht, auch wenn zwei Aufrufe gleichzeitig kommen.
    { idempotencyKey: `zahlung-${target.installmentId}-${target.paymentIntentId ?? "erste"}` },
  );
  await transaction("system:stripe", (c) =>
    rememberPaymentIntent(c, { id: intent.id, installmentId: target.installmentId, amountCents: intent.amount, currency: intent.currency }),
  );
  if (!intent.client_secret) throw new Error("Stripe hat kein client_secret geliefert");
  return { state: "bereit", target, clientSecret: intent.client_secret };
}

async function ensureStripeCustomer(
  api: Stripe,
  who: { customerId: string; stripeCustomerId: string | null; email: string; name: string },
): Promise<string> {
  if (who.stripeCustomerId) return who.stripeCustomerId;
  const created = await api.customers.create(
    { email: who.email, name: who.name || undefined, metadata: { customer_id: who.customerId } },
    { idempotencyKey: `kunde-${who.customerId}` },
  );
  await rememberStripeCustomer(pool(), who.customerId, created.id);
  return created.id;
}

/** Karte für eine Probezeit ohne Anzahlung hinterlegen lassen (SetupIntent, nichts wird abgebucht). */
async function prepareCardSetup(api: Stripe, orderId: string): Promise<PreparedPayment> {
  const setup = await cardSetupTarget(pool(), orderId);
  if (!setup) return { state: "nichts_faellig" };
  const customer = await ensureStripeCustomer(api, setup);
  const intent = await api.setupIntents.create(
    {
      customer,
      usage: "off_session",
      automatic_payment_methods: { enabled: true },
      metadata: { order_id: orderId },
    },
    // Beim Neuladen der Seite dieselbe Hinterlegung, keine zweite.
    { idempotencyKey: `karte-${orderId}` },
  );
  if (!intent.client_secret) throw new Error("Stripe hat kein client_secret geliefert");
  return { state: "karte_hinterlegen", setup, clientSecret: intent.client_secret };
}

/**
 * Nach der Rückkehr von Stripe: bestätigte Karten-Hinterlegung zur Bestellung merken.
 * Liest den Stand bei Stripe selbst, der Rückgabe-Link allein zählt nicht.
 */
export async function completeCardSetup(api: Stripe, orderId: string, setupIntentId: string): Promise<boolean> {
  const intent = await api.setupIntents.retrieve(setupIntentId);
  const id = (v: string | { id: string } | null) => (v == null ? null : typeof v === "string" ? v : v.id);
  return rememberCardSetup(pool(), {
    orderId,
    setupOrderId: intent.metadata?.order_id ?? null,
    status: intent.status,
    paymentMethod: id(intent.payment_method),
    stripeCustomerId: id(intent.customer as string | { id: string } | null),
  });
}
