import { handlePaypalCapture } from "@idf/db/paypal";
import { handlePaypalAboPayment } from "@idf/db/takeover";
import { transaction } from "../../../../lib/db";
import { captureFromWebhook, isPaypalLive, paypal, type PaypalSale, type PaypalWebhookEvent } from "../../../../lib/paypal";
import { aboPaymentFromSale } from "../../../../lib/takeover";

export const dynamic = "force-dynamic";

/**
 * Meldungen von PayPal. Fängt Zahlungen auf, deren direkte Bestätigung verloren ging,
 * und ausstehende Zahlungen, die später abgeschlossen werden. Die Signatur prüft PayPal selbst.
 */
export async function POST(request: Request): Promise<Response> {
  const api = paypal();
  if (!api) return Response.json({ error: "PayPal ist nicht eingerichtet" }, { status: 503 });
  const event = (await request.json().catch(() => null)) as PaypalWebhookEvent | null;
  if (!event?.id || !event.event_type) return Response.json({ error: "Meldung unlesbar" }, { status: 400 });

  let valid: boolean;
  try {
    valid = await api.verifyWebhook(request.headers, event);
  } catch (err) {
    console.error("PayPal-Signaturprüfung nicht möglich", (err as Error).message);
    return Response.json({ error: "Prüfung nicht möglich" }, { status: 502 });
  }
  if (!valid) return Response.json({ error: "Signatur ungültig" }, { status: 400 });

  // Zahlung eines aus Thrivecart übernommenen PayPal-Abos (bucht PayPal selbst ab).
  const abo = aboPaymentFromSale(event.event_type, event.resource as PaypalSale | undefined, isPaypalLive());
  if (abo) {
    const h = await transaction("system:paypal-abo", (c) => handlePaypalAboPayment(c, abo));
    if (h.outcome === "pruefen" && h.firstDelivery) console.error(`PayPal-Abozahlung nicht verbucht, bitte prüfen: ${event.id} (${h.note ?? "ohne Hinweis"})`);
    return Response.json({ outcome: h.outcome });
  }

  const input = captureFromWebhook(event);
  const handled = await transaction("system:paypal", (c) => handlePaypalCapture(c, input));
  if (handled.outcome === "pruefen" && handled.firstDelivery) {
    console.error(`PayPal-Zahlung nicht verbucht, bitte prüfen: ${event.id} (${handled.note ?? "ohne Hinweis"})`);
  }
  return Response.json({ outcome: handled.outcome });
}
