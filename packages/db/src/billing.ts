import { paymentSchedule, splitAmount, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import type pg from "pg";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Wiederkehrende Zahlungen: Abos verlängern, fällige Raten zum Einzug auswählen,
 * Einzugsversuche festhalten. Der Einzug selbst (Stripe, PayPal) läuft in der Web-App.
 */

type Db = pg.Pool | pg.ClientBase;

/** Wartezeit nach einem gescheiterten Einzug, bevor es erneut versucht wird (Tage). Danach: Mahnwesen. */
export const RETRY_AFTER_DAYS = [3, 4];
export const MAX_ATTEMPTS = RETRY_AFTER_DAYS.length + 1;

/**
 * Für laufende Abos die Fälligkeiten bis einschließlich `untilDay` anlegen. Betrag und
 * Termin folgen aus den bei der Bestellung festgeschriebenen Bedingungen. Nach einer
 * Kündigung entstehen keine Fälligkeiten nach dem Vertragsende.
 */
export async function extendSubscriptions(client: pg.ClientBase, untilDay: string): Promise<number> {
  const { rows } = await client.query<{
    order_item_id: string;
    order_id: string;
    plan: PricePlan;
    purchase_day: string;
    amount_basis: AmountBasis;
    tax_rate_bp: number;
    ends_on: string | null;
    last_seq: number;
  }>(
    `select t.order_item_id, t.order_id, t.plan, t.purchase_day::text, t.amount_basis, t.tax_rate_bp, t.ends_on::text,
            (select max(seq) from app.order_installments i where i.order_item_id = t.order_item_id) last_seq
       from app.subscription_terms t
       join app.orders o on o.id = t.order_id
      where o.status not in ('storniert', 'erstattet')
      for update of t`,
  );
  let created = 0;
  for (const t of rows) {
    let seq = t.last_seq;
    for (;;) {
      const next = paymentSchedule(t.plan, t.purchase_day, seq + 1)[seq];
      if (!next || next.dueDate > untilDay || (t.ends_on && next.dueDate > t.ends_on)) break;
      const a = splitAmount(next.amountCents, t.amount_basis, t.tax_rate_bp);
      seq++;
      await client.query(
        `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (order_item_id, seq) do nothing`,
        [t.order_id, t.order_item_id, seq, next.dueDate, a.netCents, a.taxCents, a.grossCents],
      );
      created++;
    }
  }
  return created;
}

export interface DueCharge {
  installmentId: string;
  orderId: string;
  seq: number;
  dueDate: string;
  grossCents: number;
  currency: string;
  customerId: string;
  attempts: number;
  method: { provider: "stripe" | "paypal"; ref: string; providerCustomer: string | null } | null;
}

/**
 * Fälligkeiten, die jetzt automatisch eingezogen werden: ab der zweiten Zahlung (die
 * erste zahlt die Kundin selbst auf der Bestellseite; bei Probezeit ohne Anzahlung
 * hinterlegt sie dort nur die Karte, dann wird auch die erste eingezogen), höchstens MAX_ATTEMPTS Versuche,
 * mit Wartezeit nach einem gescheiterten Versuch und nie, solange ein Einzug unterwegs ist.
 */
export async function dueCharges(client: Db, today: string): Promise<DueCharge[]> {
  const { rows } = await client.query(
    `select i.id, i.order_id, i.seq, i.due_date::text, i.gross_cents, o.currency, o.customer_id,
            coalesce(a.n, 0) attempts, a.last_outcome, a.last_day::text,
            m.provider, m.ref, m.provider_customer
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       left join lateral (
         select count(*)::int n,
                (array_agg(outcome order by attempted_at desc))[1] last_outcome,
                max((attempted_at at time zone 'Europe/Berlin')::date) last_day
           from app.charge_attempts x where x.installment_id = i.id) a on true
       left join lateral (
         select provider, ref, provider_customer from app.saved_payment_methods s
          where s.customer_id = o.customer_id and s.revoked_at is null
          order by s.created_at desc limit 1) m on true
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
      -- Ab der zweiten Zahlung; bei Probezeit ohne Anzahlung (erste Zahlung 0) auch die erste.
      where i.status in ('offen', 'fehlgeschlagen') and (i.seq > 1 or po.amount_cents = 0) and i.due_date <= $1
        and o.status not in ('storniert', 'erstattet')
        -- Bestellungen per Rechnung zahlt die Kundin selbst per Überweisung.
        and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
      order by i.due_date, i.id`,
    [today],
  );
  const result: DueCharge[] = [];
  for (const r of rows) {
    const attempts = Number(r.attempts);
    if (attempts >= MAX_ATTEMPTS) continue;
    if (r.last_outcome === "eingereicht") continue;
    if (attempts > 0) {
      const wait = RETRY_AFTER_DAYS[attempts - 1]!;
      const earliest = new Date(`${r.last_day}T00:00:00Z`);
      earliest.setUTCDate(earliest.getUTCDate() + wait);
      if (earliest.toISOString().slice(0, 10) > today) continue;
    }
    result.push({
      installmentId: r.id,
      orderId: r.order_id,
      seq: r.seq,
      dueDate: r.due_date,
      grossCents: Number(r.gross_cents),
      currency: r.currency,
      customerId: r.customer_id,
      attempts,
      method: r.provider ? { provider: r.provider, ref: r.ref, providerCustomer: r.provider_customer } : null,
    });
  }
  return result;
}

/** Einzugsversuch festhalten. Bei Ablehnung wird die Fälligkeit als fehlgeschlagen markiert. */
export async function recordChargeAttempt(
  client: Db,
  input: { installmentId: string; provider: "stripe" | "paypal"; providerRef: string | null; outcome: "eingereicht" | "gebucht" | "abgelehnt" | "fehler"; errorCode?: string | null },
) {
  await client.query(
    `insert into app.charge_attempts (installment_id, provider, provider_ref, outcome, error_code) values ($1, $2, $3, $4, $5)`,
    [input.installmentId, input.provider, input.providerRef, input.outcome, input.errorCode ?? null],
  );
  if (input.outcome === "abgelehnt") {
    await client.query(`update app.order_installments set status = 'fehlgeschlagen' where id = $1 and status = 'offen'`, [input.installmentId]);
  }
}

/** Zahlungsart für spätere Einzüge merken. */
export async function rememberPaymentMethod(
  client: Db,
  input: { customerId: string; provider: "stripe" | "paypal"; ref: string; providerCustomer?: string | null },
) {
  await client.query(
    `insert into app.saved_payment_methods (customer_id, provider, ref, provider_customer) values ($1, $2, $3, $4)
     on conflict (provider, ref) do nothing`,
    [input.customerId, input.provider, input.ref, input.providerCustomer ?? null],
  );
}

/** Abo nach Kündigung beenden: letzter Tag der Laufzeit. Einmalig. */
export async function endSubscription(client: Db, orderId: string, endsOn: string, endedBy: string): Promise<boolean> {
  const r = await client.query(
    `update app.subscription_terms set ends_on = $2, ended_by = $3 where order_id = $1 and ends_on is null`,
    [orderId, endsOn, endedBy],
  );
  if (!r.rowCount) return false;
  await enqueueWebhook(client as pg.ClientBase, "abo.beendet", orderId, { ends_on: endsOn });
  // Offene Fälligkeiten nach dem Vertragsende entfallen.
  await client.query(
    `update app.order_installments set status = 'storniert' where order_id = $1 and due_date > $2 and status in ('offen', 'fehlgeschlagen')`,
    [orderId, endsOn],
  );
  return true;
}
