import { rememberPaypalOrder } from "@idf/db/paypal";
import { nextPaymentTarget } from "@idf/db/stripe";
import { pool } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";
import { paypal } from "../../../../lib/paypal";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Legt für die fällige Rate einer Bestellung eine PayPal-Bestellung an. Betrag und Rate bestimmt der Server. */
export async function POST(request: Request): Promise<Response> {
  const api = paypal();
  if (!api) return Response.json({ error: "PayPal ist nicht eingerichtet" }, { status: 503 });
  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId || !UUID.test(orderId)) return Response.json({ error: "Bestellung fehlt" }, { status: 400 });

  const target = await nextPaymentTarget(pool(), orderId, todayBerlin());
  if (!target) return Response.json({ error: "Jetzt ist nichts zu bezahlen" }, { status: 409 });
  const info = (
    await pool().query<{ legal_name: string; product: string; label: string; count: number }>(
      `select co.legal_name, p.name product, po.label,
              (select count(*)::int from app.order_installments x where x.order_item_id = i.order_item_id) count
         from app.order_installments i
         join app.orders o on o.id = i.order_id
         join app.companies co on co.id = o.company_id
         join app.order_items it on it.id = i.order_item_id
         join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
        where i.id = $1`,
      [target.installmentId],
    )
  ).rows[0]!;

  try {
    const created = await api.createOrder({
      installmentId: target.installmentId,
      amountCents: target.grossCents,
      currency: target.currency,
      description: `${info.product} – ${info.label}${info.count > 1 ? ` (Zahlung ${target.seq} von ${info.count})` : ""}`,
      brandName: info.legal_name,
      vault: target.recurring,
      requestId: `bestellung-${target.installmentId}-${Date.now()}`,
    });
    await rememberPaypalOrder(pool(), {
      id: created.id,
      installmentId: target.installmentId,
      amountCents: target.grossCents,
      currency: target.currency,
    });
    return Response.json({ id: created.id });
  } catch (err) {
    console.error("PayPal-Bestellung fehlgeschlagen", (err as Error).message);
    return Response.json({ error: "PayPal ist gerade nicht erreichbar" }, { status: 502 });
  }
}
