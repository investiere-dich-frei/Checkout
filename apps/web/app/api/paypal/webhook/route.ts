import { handlePaypalCapture } from "@idf/db/paypal";
import { transaction } from "../../../../lib/db";
import { captureFromWebhook, paypal, type PaypalWebhookEvent } from "../../../../lib/paypal";

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

  const input = captureFromWebhook(event);
  const handled = await transaction("system:paypal", (c) => handlePaypalCapture(c, input));
  if (handled.outcome === "pruefen" && handled.firstDelivery) {
    console.error(`PayPal-Zahlung nicht verbucht, bitte prüfen: ${event.id} (${handled.note ?? "ohne Hinweis"})`);
  }
  return Response.json({ outcome: handled.outcome });
}
