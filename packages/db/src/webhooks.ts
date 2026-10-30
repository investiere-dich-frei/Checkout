import { createHmac } from "node:crypto";
import type pg from "pg";
import { ACCESS_DELAY_DAYS } from "./legal.ts";

/**
 * Ausgehende Webhooks. Ereignisse entstehen in der Transaktion ihres Anlasses;
 * `deliverWebhooks` stellt sie zu. Jede Meldung trägt eine HMAC-SHA256-Signatur
 * über „<Zeitstempel>.<Inhalt>“, damit der Empfänger (n8n) Fälschungen erkennt.
 */

export type WebhookEvent = "zahlung.eingegangen" | "zahlung.erstattet" | "abo.beendet" | "bestellung.beendet";

/** Bestellung mit Kundin und Produkt, wie sie Empfänger für Kurszugang und CRM brauchen. */
async function orderPayload(client: pg.ClientBase, orderId: string) {
  const { rows } = await client.query(
    `select o.id order_id, o.status, o.currency, o.total_gross_cents, o.created_at,
            -- Kurszugang: sofort bei Sofortstart oder Sofortzugang, sonst am Tag nach Ablauf der Widerrufsfrist.
            o.withdrawal_waiver_at sofortstart_at,
            case when o.withdrawal_waiver_at is not null or p.immediate_access then (o.created_at at time zone 'Europe/Berlin')::date
                 else (o.created_at at time zone 'Europe/Berlin')::date + $2::int end::text access_from,
            jsonb_build_object('id', c.id, 'email', c.email, 'first_name', c.first_name, 'last_name', c.last_name,
                               'company_name', c.company_name, 'country', c.country, 'hubspot_contact_id', c.hubspot_contact_id) customer,
            jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug, 'thrivecart_product_id', p.thrivecart_product_id,
                               'external_refs', p.external_refs) product,
            jsonb_build_object('id', po.id, 'label', po.label, 'kind', po.kind, 'thrivecart_option_id', po.thrivecart_option_id) price_option,
            u.sales_code seller
       from app.orders o
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       left join app.users u on u.id = o.seller_user_id
      where o.id = $1`,
    [orderId, ACCESS_DELAY_DAYS],
  );
  return rows[0];
}

export async function enqueueWebhook(client: pg.ClientBase, event: WebhookEvent, orderId: string, extra: Record<string, unknown> = {}) {
  const order = await orderPayload(client, orderId);
  if (!order) return;
  await client.query(`insert into app.webhook_outbox (event_type, payload) values ($1, $2)`, [
    event,
    JSON.stringify({ event, ...extra, order }),
  ]);
}

export function sign(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(360, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/** Fällige Webhooks zustellen. Gibt nur Zahlen zurück. 2xx gilt als zugestellt. */
export async function deliverWebhooks(
  pool: pg.Pool,
  target: { url: string; secret: string },
  fetchFn: typeof fetch = fetch,
  limit = 50,
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.actor', 'system:webhooks', true)`);
      const { rows } = await c.query<{ id: string; event_type: string; payload: unknown; attempts: number }>(
        `select id, event_type, payload, attempts from app.webhook_outbox
          where delivered_at is null and next_attempt_at <= now()
          order by created_at limit 1 for update skip locked`,
      );
      const w = rows[0];
      if (!w) {
        await c.query("commit");
        break;
      }
      const body = JSON.stringify({ id: w.id, ...(w.payload as object) });
      const ts = Math.floor(Date.now() / 1000);
      let status: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetchFn(target.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idf-event": w.event_type,
            "x-idf-delivery": w.id,
            "x-idf-timestamp": String(ts),
            "x-idf-signature": sign(target.secret, ts, body),
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        status = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = String((err as Error).message).slice(0, 300);
      }
      if (!error) {
        await c.query(`update app.webhook_outbox set delivered_at = now(), attempts = attempts + 1, response_status = $2, last_error = null where id = $1`, [w.id, status]);
        delivered++;
      } else {
        await c.query(
          `update app.webhook_outbox set attempts = attempts + 1, response_status = $2, last_error = $3,
                  next_attempt_at = now() + $4 * interval '1 millisecond' where id = $1`,
          [w.id, status, error, retryDelayMs(w.attempts + 1)],
        );
        failed++;
      }
      await c.query("commit");
    } catch (err) {
      await c.query("rollback").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
  return { delivered, failed };
}
