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
      // In einer Pause fällige Zahlungen entfallen (erlassen), Betrag und Termin bleiben stehen.
      await client.query(
        `insert into app.order_installments (order_id, order_item_id, seq, due_date, net_cents, tax_cents, gross_cents, status)
         values ($1, $2, $3, $4, $5, $6, $7,
                 case when exists (select 1 from app.subscription_pauses p where p.order_id = $1 and p.starts_on <= $4::date
                                     and (p.ends_on is null or p.ends_on >= $4::date)) then 'erlassen' else 'offen' end)
         on conflict (order_item_id, seq) do nothing`,
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
      where i.status in ('offen', 'fehlgeschlagen') and i.due_date <= $1
        and (i.seq > 1 or po.amount_cents = 0
             -- Aus Thrivecart übernommen: Die Karte liegt schon vor, auch die erste Zahlung wird eingezogen.
             or exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id))
        and o.status not in ('storniert', 'erstattet')
        -- Übernommene PayPal-Abos bucht PayPal selbst ab; die Zahlung kommt per Meldung von PayPal.
        and not exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal')
        -- Bestellungen per Rechnung zahlt die Kundin selbst per Überweisung.
        and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
        -- Nie während einer Pause (die Fälligkeiten darin sind ohnehin erlassen).
        and not exists (select 1 from app.subscription_pauses p where p.order_id = o.id and p.starts_on <= i.due_date
                          and (p.ends_on is null or p.ends_on >= i.due_date))
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

/** Warum eine Rate gerade nicht von Hand eingezogen werden kann. */
export type ManualChargeBlock =
  | "nicht_gefunden"
  | "nicht_offen"
  | "noch_nicht_faellig"
  | "unterwegs"
  | "per_rechnung"
  | "bestellung_beendet"
  | "keine_zahlungsart"
  | "paypal_abo";

/**
 * Eine offene oder fehlgeschlagene Rate sofort einziehen (Knopf in der Verwaltung), ohne die
 * Wartezeit und die Höchstzahl des täglichen Laufs. Nie, solange ein Einzug unterwegs ist,
 * vor der Fälligkeit oder bei Bestellungen per Rechnung.
 */
export async function manualChargeTarget(db: Db, installmentId: string, today: string): Promise<{ ok: true; charge: DueCharge } | { ok: false; reason: ManualChargeBlock }> {
  const { rows } = await db.query(
    `select i.id, i.order_id, i.seq, i.due_date::text, i.gross_cents, i.status, o.status order_status, o.currency, o.customer_id,
            coalesce(a.n, 0) attempts, a.last_outcome,
            exists (select 1 from app.manual_orders mo where mo.order_id = o.id) manual,
            exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal') paypal_abo,
            m.provider, m.ref, m.provider_customer
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       left join lateral (
         select count(*)::int n, (array_agg(outcome order by attempted_at desc))[1] last_outcome
           from app.charge_attempts x where x.installment_id = i.id) a on true
       left join lateral (
         select provider, ref, provider_customer from app.saved_payment_methods s
          where s.customer_id = o.customer_id and s.revoked_at is null
          order by s.created_at desc limit 1) m on true
      where i.id = $1`,
    [installmentId],
  );
  const r = rows[0];
  if (!r) return { ok: false, reason: "nicht_gefunden" };
  if (r.status !== "offen" && r.status !== "fehlgeschlagen") return { ok: false, reason: "nicht_offen" };
  if (r.order_status === "storniert" || r.order_status === "erstattet") return { ok: false, reason: "bestellung_beendet" };
  if (r.manual) return { ok: false, reason: "per_rechnung" };
  if (r.paypal_abo) return { ok: false, reason: "paypal_abo" };
  if (r.due_date > today) return { ok: false, reason: "noch_nicht_faellig" };
  if (r.last_outcome === "eingereicht") return { ok: false, reason: "unterwegs" };
  if (!r.provider) return { ok: false, reason: "keine_zahlungsart" };
  return {
    ok: true,
    charge: {
      installmentId: r.id,
      orderId: r.order_id,
      seq: r.seq,
      dueDate: r.due_date,
      grossCents: Number(r.gross_cents),
      currency: r.currency,
      customerId: r.customer_id,
      attempts: Number(r.attempts),
      method: { provider: r.provider, ref: r.ref, providerCustomer: r.provider_customer },
    },
  };
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

export class PauseError extends Error {}

export interface Pause {
  id: string;
  startsOn: string;
  endsOn: string | null;
  reason: string | null;
  createdBy: string;
  endedBy: string | null;
}

export async function listPauses(db: Db, orderId: string): Promise<Pause[]> {
  const { rows } = await db.query(
    `select id, starts_on::text, ends_on::text, reason, created_by, ended_by from app.subscription_pauses where order_id = $1 order by starts_on, created_at`,
    [orderId],
  );
  return rows.map((r) => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason, createdBy: r.created_by, endedBy: r.ended_by }));
}

const prevDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

/**
 * Laufendes Abo pausieren: ab `startsOn` (frühestens heute) bis einschließlich `endsOn`, oder
 * unbefristet (endsOn null). Offene Fälligkeiten im Zeitraum entfallen; eine, deren Einzug
 * gerade unterwegs ist, bleibt. Gibt die Zahl entfallener Fälligkeiten zurück.
 */
export async function pauseSubscription(
  client: pg.ClientBase,
  input: { orderId: string; startsOn: string; endsOn: string | null; reason?: string | null; actor: string; today: string },
): Promise<number> {
  const { orderId, startsOn, endsOn } = input;
  if (startsOn < input.today) throw new PauseError("Eine Pause kann frühestens heute beginnen.");
  if (endsOn && endsOn < startsOn) throw new PauseError("Das Ende der Pause liegt vor dem Beginn.");
  const t = (
    await client.query(
      `select t.ends_on::text, o.status from app.subscription_terms t join app.orders o on o.id = t.order_id
        where t.order_id = $1 for update of t`,
      [orderId],
    )
  ).rows[0];
  if (!t) throw new PauseError("Nur Abos lassen sich pausieren.");
  if (t.status === "storniert" || t.status === "erstattet") throw new PauseError("Die Bestellung ist storniert oder erstattet.");
  if (t.ends_on && t.ends_on < startsOn) throw new PauseError("Das Abo endet vor dem Beginn der Pause.");
  const overlap = await client.query(
    `select 1 from app.subscription_pauses where order_id = $1 and (ends_on is null or ends_on >= $2) and ($3::date is null or starts_on <= $3::date)`,
    [orderId, startsOn, endsOn],
  );
  if (overlap.rowCount) throw new PauseError("In diesem Zeitraum gibt es schon eine Pause.");
  await client.query(`insert into app.subscription_pauses (order_id, starts_on, ends_on, reason, created_by) values ($1, $2, $3, $4, $5)`, [
    orderId,
    startsOn,
    endsOn,
    input.reason?.trim() || null,
    input.actor,
  ]);
  const waived = await client.query(
    `update app.order_installments i set status = 'erlassen'
      where i.order_id = $1 and i.status in ('offen', 'fehlgeschlagen') and i.due_date >= $2 and ($3::date is null or i.due_date <= $3::date)
        and coalesce((select a.outcome from app.charge_attempts a where a.installment_id = i.id order by a.attempted_at desc limit 1), '') <> 'eingereicht'`,
    [orderId, startsOn, endsOn],
  );
  await enqueueWebhook(client, "abo.pausiert", orderId, { starts_on: startsOn, ends_on: endsOn });
  return waived.rowCount ?? 0;
}

/**
 * Pause beenden: ab heute läuft das Abo wieder. Fälligkeiten ab heute, die wegen der Pause
 * entfallen waren, sind wieder offen; frühere bleiben erlassen. Eine noch nicht begonnene
 * Pause wird aufgehoben. Gibt false zurück, wenn keine Pause offen ist.
 */
export async function resumeSubscription(client: pg.ClientBase, input: { orderId: string; actor: string; today: string }): Promise<boolean> {
  const p = (
    await client.query(
      `select id, starts_on::text, ends_on::text from app.subscription_pauses
        where order_id = $1 and ended_by is null and (ends_on is null or ends_on >= $2) order by starts_on limit 1 for update`,
      [input.orderId, input.today],
    )
  ).rows[0];
  if (!p) return false;
  const newEnd = p.starts_on >= input.today ? prevDay(p.starts_on) : prevDay(input.today);
  await client.query(`update app.subscription_pauses set ends_on = $2, ended_by = $3 where id = $1`, [p.id, newEnd, input.actor]);
  // Nur Fälligkeiten, die in den Rest der Pause fielen und nicht durch eine andere Pause entfallen.
  await client.query(
    `update app.order_installments i set status = 'offen'
      where i.order_id = $1 and i.status = 'erlassen' and i.due_date > $2 and ($3::date is null or i.due_date <= $3::date)
        and not exists (select 1 from app.subscription_pauses q where q.order_id = i.order_id and q.id <> $4
                          and q.starts_on <= i.due_date and (q.ends_on is null or q.ends_on >= i.due_date))`,
    [input.orderId, newEnd, p.ends_on, p.id],
  );
  await enqueueWebhook(client, "abo.fortgesetzt", input.orderId, { resumed_on: input.today });
  return true;
}
