import type pg from "pg";
import { MAX_ATTEMPTS, RETRY_AFTER_DAYS } from "./billing.ts";
import { companyFooter, day, euro, salutation } from "./customer-mails.ts";
import { createPortalToken } from "./customer-portal.ts";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Mahnwesen: E-Mails rund um automatische Abbuchungen. Der tägliche Lauf (scripts/einzug.ts) sucht
 * nach dem Einzug die Anlässe und verschickt jede Benachrichtigung höchstens einmal (dedupe_key).
 *
 *  - erinnerung:        REMINDER_DAYS_BEFORE Tage vor einer Abbuchung, nur bei Abständen ab
 *                       REMINDER_MIN_INTERVAL_MONTHS Monaten (Quartal, Jahr). Monatlich wäre lästig.
 *  - fehlgeschlagen:    nach jedem abgelehnten Versuch, mit Termin des nächsten Versuchs; auch wenn
 *                       eine fällige Zahlung ohne hinterlegte Zahlungsart nicht abgebucht werden kann.
 *  - letzte_mahnung:    nach dem letzten automatischen Versuch.
 *  - karte_ablauf:      die gespeicherte Karte läuft vor der nächsten Abbuchung ab.
 *
 * Jede E-Mail enthält einen persönlichen Link zum Kundenbereich, über den die Kundin die Karte ändert;
 * eine fehlgeschlagene Rate wird dort nach dem Wechsel gleich abgebucht.
 */

type Db = pg.Pool | pg.ClientBase;

export const REMINDER_DAYS_BEFORE = 7;
export const REMINDER_MIN_INTERVAL_MONTHS = 3;
/** Nur Fehlversuche der letzten Tage melden, alte nicht nachträglich. */
export const FAILED_LOOKBACK_DAYS = 7;
/** Karten prüfen für Abbuchungen in diesem Zeitraum. */
export const CARD_HORIZON_DAYS = 40;
export const DUNNING_LINK_DAYS = 14;

export type DunningKind = "erinnerung" | "fehlgeschlagen" | "ohne_zahlungsart" | "letzte_mahnung" | "karte_ablauf";

export interface DunningCase {
  kind: DunningKind;
  key: string;
  orderId: string;
  installmentId: string;
  /** Versuche bisher (fehlgeschlagen, letzte_mahnung). */
  attempts?: number;
  /** Nächster automatischer Versuch (fehlgeschlagen). */
  nextTry?: string | null;
  /** Karte (karte_ablauf). */
  card?: { brand: string | null; last4: string | null; expMonth: number; expYear: number };
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * Bedingungen wie beim automatischen Einzug (billing.dueCharges): Rate wird abgebucht, Bestellung
 * läuft, nicht per Rechnung, kein PayPal-Abo aus Thrivecart, nicht in einer Pause.
 */
const AUTO_CHARGED = `
  (i.seq > 1 or po.amount_cents = 0 or exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id))
  and o.status not in ('storniert', 'erstattet')
  and not exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal')
  and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
  and not exists (select 1 from app.subscription_pauses p where p.order_id = o.id and p.starts_on <= i.due_date
                    and (p.ends_on is null or p.ends_on >= i.due_date))`;

const FROM = `
  from app.order_installments i
  join app.orders o on o.id = i.order_id
  join app.order_items it on it.id = i.order_item_id
  join app.price_options po on po.id = it.price_option_id
  left join app.subscription_terms st on st.order_item_id = it.id
  left join lateral (
    select provider, ref from app.saved_payment_methods s
     where s.customer_id = o.customer_id and s.revoked_at is null order by s.created_at desc limit 1) m on true`;

/** Anlässe für Erinnerungen und Mahnungen an diesem Tag (ohne Kartenablauf, der braucht Stripe). */
export async function dunningCases(db: Db, today: string): Promise<DunningCase[]> {
  const cases: DunningCase[] = [];

  const reminders = await db.query<{ id: string; order_id: string }>(
    `select i.id, i.order_id ${FROM}
      where i.status = 'offen' and i.due_date > $1::date and i.due_date <= $1::date + $2::int
        and m.provider is not null
        and coalesce((st.plan->>'intervalMonths')::int, po.interval_months, 0) >= $3
        and ${AUTO_CHARGED}
      order by i.due_date, i.id`,
    [today, REMINDER_DAYS_BEFORE, REMINDER_MIN_INTERVAL_MONTHS],
  );
  for (const r of reminders.rows) cases.push({ kind: "erinnerung", key: `erinnerung:${r.id}`, orderId: r.order_id, installmentId: r.id });

  const failed = await db.query<{ id: string; order_id: string; n: number; last_outcome: string; last_day: string }>(
    `select i.id, i.order_id, a.n, a.last_outcome, a.last_day::text ${FROM}
       join lateral (
         select count(*)::int n, (array_agg(outcome order by attempted_at desc))[1] last_outcome,
                max((attempted_at at time zone 'Europe/Berlin')::date) last_day
           from app.charge_attempts x where x.installment_id = i.id) a on a.n > 0
      where i.status = 'fehlgeschlagen' and a.last_outcome = 'abgelehnt' and a.last_day >= $1::date - $2::int
        and ${AUTO_CHARGED}
      order by i.due_date, i.id`,
    [today, FAILED_LOOKBACK_DAYS],
  );
  for (const r of failed.rows) {
    if (r.n >= MAX_ATTEMPTS) {
      cases.push({ kind: "letzte_mahnung", key: `letzte_mahnung:${r.id}`, orderId: r.order_id, installmentId: r.id, attempts: r.n });
    } else {
      cases.push({
        kind: "fehlgeschlagen",
        key: `fehlgeschlagen:${r.id}:${r.n}`,
        orderId: r.order_id,
        installmentId: r.id,
        attempts: r.n,
        nextTry: addDays(r.last_day, RETRY_AFTER_DAYS[r.n - 1]!),
      });
    }
  }

  const withoutMethod = await db.query<{ id: string; order_id: string }>(
    `select i.id, i.order_id ${FROM}
      where i.status in ('offen', 'fehlgeschlagen') and i.due_date <= $1::date and i.due_date > $1::date - $2::int
        and m.provider is null
        and ${AUTO_CHARGED}
      order by i.due_date, i.id`,
    [today, FAILED_LOOKBACK_DAYS],
  );
  for (const r of withoutMethod.rows) {
    cases.push({ kind: "ohne_zahlungsart", key: `ohne_zahlungsart:${r.id}`, orderId: r.order_id, installmentId: r.id });
  }
  return cases;
}

export interface CardToCheck {
  ref: string;
  providerCustomer: string | null;
  orderId: string;
  installmentId: string;
  dueDate: string;
  /** Gespeichertes Ablaufdatum, falls schon von Stripe gelesen. */
  cached: { brand: string | null; last4: string | null; expMonth: number; expYear: number } | null;
}

/**
 * Stripe-Karten, über die in den nächsten CARD_HORIZON_DAYS Tagen abgebucht wird und zu denen noch
 * keine Ablauf-Mahnung verschickt wurde. Je Karte die nächste Fälligkeit.
 */
export async function cardsToCheck(db: Db, today: string): Promise<CardToCheck[]> {
  const { rows } = await db.query(
    `select distinct on (s.ref) s.ref, s.provider_customer, i.order_id, i.id installment_id, i.due_date::text,
            c.brand, c.last4, c.exp_month, c.exp_year
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
       join lateral (
         select provider, ref, provider_customer from app.saved_payment_methods s
          where s.customer_id = o.customer_id and s.revoked_at is null order by s.created_at desc limit 1) s on s.provider = 'stripe'
       left join app.payment_method_cards c on c.ref = s.ref
      where i.status = 'offen' and i.due_date >= $1::date and i.due_date <= $1::date + $2::int
        and ${AUTO_CHARGED}
        and not exists (select 1 from app.dunning_notices d where d.dedupe_key = 'karte_ablauf:' || s.ref)
      order by s.ref, i.due_date`,
    [today, CARD_HORIZON_DAYS],
  );
  return rows.map((r) => ({
    ref: r.ref,
    providerCustomer: r.provider_customer,
    orderId: r.order_id,
    installmentId: r.installment_id,
    dueDate: r.due_date,
    cached: r.exp_month ? { brand: r.brand, last4: r.last4, expMonth: r.exp_month, expYear: r.exp_year } : null,
  }));
}

export async function rememberCard(db: Db, ref: string, card: { brand: string | null; last4: string | null; expMonth: number; expYear: number }) {
  await db.query(
    `insert into app.payment_method_cards (ref, brand, last4, exp_month, exp_year) values ($1, $2, $3, $4, $5)
     on conflict (ref) do update set brand = excluded.brand, last4 = excluded.last4, exp_month = excluded.exp_month,
       exp_year = excluded.exp_year, fetched_at = now()`,
    [ref, card.brand, card.last4, card.expMonth, card.expYear],
  );
}

/** Letzter Tag, an dem die Karte noch gilt. */
export function cardValidUntil(expMonth: number, expYear: number): string {
  return new Date(Date.UTC(expYear, expMonth, 0)).toISOString().slice(0, 10);
}

/** Läuft die Karte vor der Fälligkeit ab? */
export function cardExpiresBefore(card: { expMonth: number; expYear: number }, dueDate: string): boolean {
  return cardValidUntil(card.expMonth, card.expYear) < dueDate;
}

const SUBJECTS: Record<DunningKind, (product: string) => string> = {
  erinnerung: (p) => `Bald fällig: deine Zahlung für ${p}`,
  fehlgeschlagen: (p) => `Zahlung nicht geklappt: ${p}`,
  ohne_zahlungsart: (p) => `Bitte Zahlungsart hinterlegen: ${p}`,
  letzte_mahnung: (p) => `Offene Zahlung für ${p}: bitte Karte aktualisieren`,
  karte_ablauf: (p) => `Deine Karte läuft bald ab: ${p}`,
};

/**
 * Eine Benachrichtigung verschicken (in den Postausgang legen), falls sie noch nicht verschickt wurde.
 * Gibt false zurück, wenn es sie schon gibt. Läuft in der Transaktion des Aufrufers.
 */
export async function sendDunningNotice(client: pg.ClientBase, c: DunningCase, baseUrl: string): Promise<boolean> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [c.key]);
  const exists = await client.query(`select 1 from app.dunning_notices where dedupe_key = $1`, [c.key]);
  if (exists.rowCount) return false;
  const { rows } = await client.query(
    `select cu.email, cu.first_name, cu.last_name, cu.company_name, p.name product, o.currency,
            i.seq, i.due_date::text, i.gross_cents, to_jsonb(co) company
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.customers cu on cu.id = o.customer_id
       join app.companies co on co.id = o.company_id
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
      where i.id = $1 and o.id = $2`,
    [c.installmentId, c.orderId],
  );
  const r = rows[0];
  if (!r) return false;
  const token = await createPortalToken(client, r.email, "system:mahnwesen", DUNNING_LINK_DAYS);
  const link = `${baseUrl.replace(/\/$/, "")}/konto/${token}`;
  const amount = euro(Number(r.gross_cents), r.currency);
  const due = day(r.due_date);
  const linkLine = `${link}\n(Der Link gilt ${DUNNING_LINK_DAYS} Tage.)`;

  let text: string[];
  switch (c.kind) {
    case "erinnerung":
      text = [
        `am ${due} buchen wir ${amount} für ${r.product} von deiner hinterlegten Zahlungsart ab. Du musst nichts tun.`,
        "",
        "Wenn du vorher die Karte ändern möchtest, geht das in deinem Kundenbereich:",
        linkLine,
      ];
      break;
    case "fehlgeschlagen":
      text = [
        `die Abbuchung von ${amount} für ${r.product} (fällig am ${due}) hat leider nicht geklappt.`,
        `Wir versuchen es am ${day(c.nextTry!)} noch einmal automatisch.`,
        "",
        "Bitte prüfe deine Karte oder hinterlege eine neue. Nach dem Wechsel buchen wir den Betrag gleich ab:",
        linkLine,
      ];
      break;
    case "ohne_zahlungsart":
      text = [
        `für ${r.product} ist seit ${due} eine Zahlung von ${amount} fällig. Bei uns ist aber keine Zahlungsart hinterlegt.`,
        "",
        "Bitte hinterlege eine Karte in deinem Kundenbereich, dann buchen wir den Betrag gleich ab:",
        linkLine,
      ];
      break;
    case "letzte_mahnung":
      text = [
        `wir konnten ${amount} für ${r.product} (fällig am ${due}) auch nach mehreren Versuchen nicht abbuchen und versuchen es nicht mehr automatisch.`,
        "",
        "Bitte hinterlege in deinem Kundenbereich eine neue Karte, dann buchen wir den offenen Betrag sofort ab:",
        linkLine,
      ];
      break;
    case "karte_ablauf": {
      const k = c.card!;
      const name = [k.brand ? k.brand.toUpperCase() : "Karte", k.last4 ? `endet auf ${k.last4}` : null].filter(Boolean).join(", ");
      text = [
        `deine hinterlegte Karte (${name}) gilt nur bis ${String(k.expMonth).padStart(2, "0")}/${k.expYear}.`,
        `Die nächste Zahlung von ${amount} für ${r.product} ist am ${due} fällig.`,
        "",
        "Bitte hinterlege rechtzeitig eine neue Karte in deinem Kundenbereich:",
        linkLine,
      ];
      break;
    }
  }
  const body = [
    salutation(r),
    "",
    ...text,
    "",
    "Wenn du Fragen hast, antworte einfach auf diese E-Mail.",
    "",
    companyFooter(r.company),
  ].join("\n");
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, related_id) values ('mahnwesen', $1, $2, $3, $4) returning id`,
    [String(r.email).trim().toLowerCase(), SUBJECTS[c.kind](r.product), body, c.orderId],
  );
  const kind = c.kind === "ohne_zahlungsart" ? "fehlgeschlagen" : c.kind;
  await client.query(
    `insert into app.dunning_notices (kind, dedupe_key, order_id, installment_id, mail_id) values ($1, $2, $3, $4, $5)`,
    [kind, c.key, c.orderId, c.installmentId, mail.rows[0]!.id],
  );
  if (c.kind === "fehlgeschlagen" || c.kind === "letzte_mahnung") {
    await enqueueWebhook(client, "zahlung.fehlgeschlagen", c.orderId, {
      installment: { seq: r.seq, due_date: r.due_date, gross_cents: Number(r.gross_cents) },
      attempts: c.attempts,
      final: c.kind === "letzte_mahnung",
      next_try: c.nextTry ?? null,
    });
  }
  return true;
}

/** Benachrichtigungen einer Bestellung für die Verwaltung. */
export async function dunningNoticesOfOrder(db: Db, orderId: string) {
  const { rows } = await db.query<{ kind: string; created_at: Date; seq: number | null; sent_at: Date | null }>(
    `select d.kind, d.created_at, i.seq, m.sent_at
       from app.dunning_notices d
       left join app.order_installments i on i.id = d.installment_id
       join app.mail_outbox m on m.id = d.mail_id
      where d.order_id = $1 order by d.created_at`,
    [orderId],
  );
  return rows;
}
