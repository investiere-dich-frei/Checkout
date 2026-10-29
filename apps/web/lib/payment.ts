import { nextPaymentTarget, rememberPaymentIntent, rememberStripeCustomer, type PaymentTarget } from "@idf/db/stripe";
import type Stripe from "stripe";
import { pool, transaction } from "./db";
import { todayBerlin } from "./format";

export type PreparedPayment =
  /** Jetzt ist nichts fällig; spätere Raten werden zum Fälligkeitstag eingezogen. */
  | { state: "nichts_faellig" }
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
  if (!target) return { state: "nichts_faellig" };
  if (!api) return { state: "nicht_eingerichtet", target };

  if (target.paymentIntentId) {
    const existing = await api.paymentIntents.retrieve(target.paymentIntentId);
    if (existing.status === "processing" || existing.status === "succeeded") return { state: "in_bearbeitung", target };
    if (REUSABLE.includes(existing.status) && existing.amount === target.grossCents && existing.client_secret) {
      return { state: "bereit", target, clientSecret: existing.client_secret };
    }
  }

  let customer = target.stripeCustomerId;
  if (!customer) {
    const created = await api.customers.create(
      { email: target.email, name: target.name || undefined, metadata: { customer_id: target.customerId } },
      { idempotencyKey: `kunde-${target.customerId}` },
    );
    customer = created.id;
    await rememberStripeCustomer(pool(), target.customerId, customer);
  }

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
