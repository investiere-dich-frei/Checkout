import { handleStripeEvent } from "@idf/db/stripe";
import type Stripe from "stripe";
import { transaction } from "../../../../lib/db";
import { stripe } from "../../../../lib/stripe";
import { toEventInput } from "../../../../lib/stripe-event";

export const dynamic = "force-dynamic";

/**
 * Meldungen von Stripe. Nur Meldungen mit gültiger Signatur werden verbucht.
 * Antwortet erst nach dem Speichern mit 200; bei einem Fehler wiederholt Stripe die Meldung.
 */
export async function POST(request: Request): Promise<Response> {
  const api = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!api || !secret) return Response.json({ error: "Stripe ist nicht eingerichtet" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Signatur fehlt" }, { status: 400 });
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = api.webhooks.constructEvent(body, signature, secret);
  } catch {
    return Response.json({ error: "Signatur ungültig" }, { status: 400 });
  }

  const handled = await transaction("system:stripe", (c) => handleStripeEvent(c, toEventInput(event)));
  // Nur IDs und Beträge ins Log, keine Kundendaten.
  if (handled.outcome === "pruefen" && handled.firstDelivery) {
    console.error(`Stripe-Zahlung nicht verbucht, bitte prüfen: ${event.id} (${handled.note ?? "ohne Hinweis"})`);
  }
  return Response.json({ outcome: handled.outcome });
}
