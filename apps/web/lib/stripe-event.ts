import type { StripeEventInput } from "@idf/db/stripe";
import type Stripe from "stripe";

/** Stripe-Ereignis auf die Werte zurückführen, die die Datenbank verbucht. */
export function toEventInput(event: Stripe.Event): StripeEventInput {
  const base = { id: event.id, type: event.type, created: event.created, payload: event };
  if (!event.type.startsWith("payment_intent.")) return base;
  const pi = event.data.object as Stripe.PaymentIntent;
  return {
    ...base,
    paymentIntent: {
      id: pi.id,
      status: pi.status,
      amountReceived: pi.amount_received,
      currency: pi.currency,
      metadata: pi.metadata ?? {},
      // Nur Zahlungsmethoden, die die Kundin für spätere Einzüge freigegeben hat.
      savedPaymentMethod: pi.setup_future_usage === "off_session" ? idOf(pi.payment_method) : null,
      stripeCustomer: idOf(pi.customer),
    },
  };
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}
