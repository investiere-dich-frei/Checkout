import { handlePaypalCapture } from "@idf/db/paypal";
import { transaction } from "../../../../lib/db";
import { captureFromOrder, paypal, PaypalError } from "../../../../lib/paypal";

export const dynamic = "force-dynamic";

/**
 * Nach der Freigabe durch die Kundin: Zahlung bei PayPal einziehen und verbuchen.
 * Verbucht wird nur, was zu einer von uns angelegten PayPal-Bestellung passt.
 */
export async function POST(request: Request): Promise<Response> {
  const api = paypal();
  if (!api) return Response.json({ error: "PayPal ist nicht eingerichtet" }, { status: 503 });
  const { paypalOrderId } = (await request.json().catch(() => ({}))) as { paypalOrderId?: string };
  if (!paypalOrderId) return Response.json({ error: "PayPal-Bestellung fehlt" }, { status: 400 });

  let captured;
  try {
    captured = await api.captureOrder(paypalOrderId);
  } catch (err) {
    const status = err instanceof PaypalError && err.status === 422 ? 422 : 502;
    console.error("PayPal-Einzug fehlgeschlagen", (err as Error).message);
    // 422: z. B. Zahlungsart abgelehnt; die Kundin kann es noch einmal versuchen.
    return Response.json({ error: "Die Zahlung mit PayPal hat nicht geklappt." }, { status });
  }

  const input = captureFromOrder(captured);
  const handled = await transaction("system:paypal", (c) => handlePaypalCapture(c, input));
  if (handled.outcome === "pruefen" && handled.firstDelivery) {
    console.error(`PayPal-Zahlung nicht verbucht, bitte prüfen: ${input.eventId} (${handled.note ?? "ohne Hinweis"})`);
  }
  return Response.json({ outcome: handled.outcome, status: input.capture?.status ?? captured.status });
}
