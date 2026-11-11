import type pg from "pg";
import { MAX_ATTEMPTS, ORDER_STARTED_SQL, RETRY_AFTER_DAYS } from "./billing.ts";
import { DEBT_ADVICE } from "./credit-texts.ts";
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

/** Für die Bestellung (Alias o) sind Mahnungen an diesem Tag ausgesetzt. */
export const holdActiveSql = (today: string) => `exists (
  select 1 from app.dunning_holds h where h.order_id = o.id and h.ended_at is null and (h.ends_on is null or h.ends_on >= ${today}))`;

/**
 * Bedingungen wie beim automatischen Einzug (billing.dueCharges): Rate wird abgebucht, Bestellung
 * läuft, nicht per Rechnung, kein PayPal-Abo aus Thrivecart, nicht in einer Pause.
 */
const AUTO_CHARGED = `
  (i.seq > 1 or po.amount_cents = 0 or exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id))
  and o.status not in ('storniert', 'erstattet')
  and ${ORDER_STARTED_SQL}
  and not exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal')
  and not exists (select 1 from app.manual_orders m where m.order_id = o.id)
  and not exists (select 1 from app.subscription_pauses p where p.order_id = o.id and p.starts_on <= i.due_date
                    and (p.ends_on is null or p.ends_on >= i.due_date))
  and not ${holdActiveSql("$1::date")}`;

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
            i.seq, i.due_date::text, i.gross_cents, to_jsonb(co) company, o.credit_check_id is not null credit
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
    // Ratenkauf mit Kredit: bei Zahlungsschwierigkeiten auf Schuldnerberatung hinweisen (§ 497a Abs. 1 BGB n. F.).
    ...(r.credit && (c.kind === "fehlgeschlagen" || c.kind === "ohne_zahlungsart" || c.kind === "letzte_mahnung")
      ? ["", `Wenn es gerade finanziell eng ist, sprich uns an: Wir finden gemeinsam eine Lösung, z. B. eine Zahlpause. ${DEBT_ADVICE}`]
      : []),
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

/**
 * Wann eine Zahlung als überfällig gilt (Aliase i = Rate, o = Bestellung, `today` als SQL-Ausdruck):
 * Rate offen und Fälligkeit vorbei, oder eine Abbuchung ist schon gescheitert. Abgebrochene Kaufvorgänge
 * zählen nicht (billing.ORDER_STARTED_SQL).
 */
export const overdueSql = (today: string) => `(
  i.status in ('offen', 'fehlgeschlagen') and (i.due_date < ${today} or i.status = 'fehlgeschlagen')
  and o.status not in ('storniert', 'erstattet')
  and ${ORDER_STARTED_SQL})`;

/**
 * Lage einer überfälligen Zahlung:
 *  - naechster_einzug:  noch kein Versuch, der tägliche Einzug bucht sie ab
 *  - erneuter_versuch:  abgelehnt, nächster automatischer Versuch geplant
 *  - laeuft:            Abbuchung eingereicht, Bestätigung der Bank steht aus
 *  - aufgegeben:        alle automatischen Versuche gescheitert, bitte nachfassen
 *  - ohne_zahlungsart:  keine Karte/kein PayPal hinterlegt
 *  - paypal_abo:        übernommenes PayPal-Abo, PayPal bucht selbst ab
 *  - ueberweisung:      manuelle Bestellung, Kundin überweist
 */
export type OverdueState =
  | "naechster_einzug"
  | "erneuter_versuch"
  | "laeuft"
  | "aufgegeben"
  | "ohne_zahlungsart"
  | "paypal_abo"
  | "ueberweisung";

export const OVERDUE_STATE_LABEL: Record<OverdueState, string> = {
  naechster_einzug: "Wird beim nächsten Einzug abgebucht",
  erneuter_versuch: "Erneuter Versuch geplant",
  laeuft: "Abbuchung läuft",
  aufgegeben: "Keine automatischen Versuche mehr",
  ohne_zahlungsart: "Keine Zahlungsart hinterlegt",
  paypal_abo: "PayPal-Abo (PayPal bucht ab)",
  ueberweisung: "Überweisung offen",
};

export interface OverduePayment {
  orderId: string;
  installmentId: string;
  seq: number;
  installments: number;
  dueDate: string;
  daysOverdue: number;
  grossCents: number;
  currency: string;
  customerId: string;
  customerName: string;
  email: string;
  product: string;
  option: string;
  isAbo: boolean;
  attempts: number;
  lastErrorCode: string | null;
  state: OverdueState;
  /** Nächster automatischer Versuch, falls einer geplant ist. */
  nextTry: string | null;
  lastNotice: { kind: string; at: Date } | null;
  /** Mahnungen ausgesetzt: bis zu diesem Tag, „offen“ = bis auf Weiteres; null = nicht ausgesetzt. */
  holdUntil: string | null;
}

/**
 * Überfällige Zahlungen für die Verwaltung (Seite Mahnwesen und Bestellansicht), älteste zuerst.
 * Ohne `orderId` alle; Sichtbarkeit regelt der Aufrufer (nur Admin und Prüfung).
 */
export async function overduePayments(
  db: Db,
  today: string,
  opts: { orderId?: string; includeManual?: boolean; limit?: number } = {},
): Promise<OverduePayment[]> {
  const { rows } = await db.query(
    `select i.id, i.order_id, i.seq, i.due_date::text, ($1::date - i.due_date)::int days, i.gross_cents, o.currency,
            (select count(*)::int from app.order_installments z where z.order_id = o.id) n_installments,
            c.id customer_id, coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) customer_name, c.email,
            p.name product, po.label option, exists (select 1 from app.subscription_terms t where t.order_id = o.id) is_abo,
            coalesce(a.n, 0) attempts, a.last_outcome, a.last_day::text, a.last_error,
            exists (select 1 from app.manual_orders m where m.order_id = o.id) is_manual,
            exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal') paypal_abo,
            exists (select 1 from app.saved_payment_methods s where s.customer_id = o.customer_id and s.revoked_at is null) has_method,
            dn.kind notice_kind, dn.created_at notice_at,
            (select coalesce(h.ends_on::text, 'offen') from app.dunning_holds h where h.order_id = o.id and h.ended_at is null
                and (h.ends_on is null or h.ends_on >= $1::date) order by h.created_at desc limit 1) hold_until
       from app.order_installments i
       join app.orders o on o.id = i.order_id
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.id = i.order_item_id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       left join lateral (
         select count(*)::int n, (array_agg(outcome order by attempted_at desc))[1] last_outcome,
                (array_agg(error_code order by attempted_at desc))[1] last_error,
                max((attempted_at at time zone 'Europe/Berlin')::date) last_day
           from app.charge_attempts x where x.installment_id = i.id) a on true
       left join lateral (
         select d.kind, d.created_at from app.dunning_notices d
          where d.installment_id = i.id order by d.created_at desc limit 1) dn on true
      where ${overdueSql("$1::date")}
        and ($2::uuid is null or o.id = $2)
        and ($3::boolean or not exists (select 1 from app.manual_orders m where m.order_id = o.id))
      order by i.due_date, i.id
      limit $4`,
    [today, opts.orderId ?? null, opts.includeManual ?? false, opts.limit ?? 500],
  );
  return rows.map((r) => {
    const attempts = Number(r.attempts);
    let state: OverdueState;
    let nextTry: string | null = null;
    if (r.is_manual) state = "ueberweisung";
    else if (r.paypal_abo) state = "paypal_abo";
    else if (r.last_outcome === "eingereicht") state = "laeuft";
    else if (!r.has_method) state = "ohne_zahlungsart";
    else if (attempts >= MAX_ATTEMPTS) state = "aufgegeben";
    else if (attempts > 0 && r.last_day) {
      state = "erneuter_versuch";
      nextTry = addDays(r.last_day, RETRY_AFTER_DAYS[attempts - 1]!);
      if (nextTry < today) nextTry = today;
    } else {
      state = "naechster_einzug";
      nextTry = today;
    }
    return {
      orderId: r.order_id,
      installmentId: r.id,
      seq: r.seq,
      installments: r.n_installments,
      dueDate: r.due_date,
      daysOverdue: Math.max(0, Number(r.days)),
      grossCents: Number(r.gross_cents),
      currency: r.currency,
      customerId: r.customer_id,
      customerName: r.customer_name,
      email: r.email,
      product: r.product,
      option: r.option,
      isAbo: r.is_abo,
      attempts,
      lastErrorCode: r.last_error ?? null,
      state,
      nextTry,
      lastNotice: r.notice_kind ? { kind: r.notice_kind, at: r.notice_at } : null,
      holdUntil: r.hold_until ?? null,
    };
  });
}

export interface DunningStats {
  from: string;
  to: string;
  /** Raten mit mindestens einer abgelehnten Abbuchung, erster Fehlschlag im Zeitraum. */
  failed: number;
  failedCents: number;
  /** Davon inzwischen bezahlt (nach Mahnung, neuer Karte oder erneutem Versuch). */
  recovered: number;
  recoveredCents: number;
  /** Davon noch offen. */
  open: number;
  openCents: number;
  /** Davon entfallen (Bestellung beendet, Pause, Storno). */
  dropped: number;
  droppedCents: number;
  /** Verschickte Benachrichtigungen im Zeitraum je Art. */
  notices: Record<string, number>;
}

/** Kennzahlen des Mahnwesens (wie „Dunning Stats“ in Thrivecart) für die letzten `days` Tage. */
export async function dunningStats(db: Db, today: string, days = 365): Promise<DunningStats> {
  const from = addDays(today, -days + 1);
  const [failed, notices] = await Promise.all([
    db.query(
      `select i.status, count(*)::int n, coalesce(sum(i.gross_cents), 0)::bigint cents
         from app.order_installments i
         join lateral (
           select min((attempted_at at time zone 'Europe/Berlin')::date) first_fail
             from app.charge_attempts x where x.installment_id = i.id and x.outcome = 'abgelehnt') f on f.first_fail is not null
        where f.first_fail between $1::date and $2::date
        group by i.status`,
      [from, today],
    ),
    db.query(
      `select kind, count(*)::int n from app.dunning_notices
        where (created_at at time zone 'Europe/Berlin')::date between $1::date and $2::date group by kind`,
      [from, today],
    ),
  ]);
  const s: DunningStats = {
    from,
    to: today,
    failed: 0,
    failedCents: 0,
    recovered: 0,
    recoveredCents: 0,
    open: 0,
    openCents: 0,
    dropped: 0,
    droppedCents: 0,
    notices: {},
  };
  for (const r of failed.rows) {
    const n = Number(r.n);
    const cents = Number(r.cents);
    s.failed += n;
    s.failedCents += cents;
    if (r.status === "bezahlt") {
      s.recovered += n;
      s.recoveredCents += cents;
    } else if (r.status === "offen" || r.status === "fehlgeschlagen") {
      s.open += n;
      s.openCents += cents;
    } else {
      s.dropped += n;
      s.droppedCents += cents;
    }
  }
  for (const r of notices.rows) s.notices[r.kind] = Number(r.n);
  return s;
}

export class DunningHoldError extends Error {}

export interface DunningHold {
  id: string;
  endsOn: string | null;
  reason: string;
  createdBy: string;
  createdAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
}

/** Aussetzungen einer Bestellung, älteste zuerst. */
export async function dunningHoldsOfOrder(db: Db, orderId: string): Promise<DunningHold[]> {
  const { rows } = await db.query(
    `select id, ends_on::text, reason, created_by, created_at, ended_at, ended_by from app.dunning_holds where order_id = $1 order by created_at`,
    [orderId],
  );
  return rows.map((r) => ({
    id: r.id,
    endsOn: r.ends_on,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    endedAt: r.ended_at,
    endedBy: r.ended_by,
  }));
}

/** Gerade geltende Aussetzung, falls es eine gibt. */
export function activeHold(holds: DunningHold[], today: string): DunningHold | null {
  return holds.find((h) => !h.endedAt && (h.endsOn === null || h.endsOn >= today)) ?? null;
}

/**
 * Mahnungen für eine Bestellung aussetzen, bis einschließlich `endsOn` oder bis auf Weiteres.
 * Ein Grund ist Pflicht (Nachweis, warum nicht gemahnt wurde). Der Einzug läuft weiter.
 */
export async function holdDunning(
  client: pg.ClientBase,
  input: { orderId: string; endsOn: string | null; reason: string; actor: string; today: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new DunningHoldError("Bitte einen Grund angeben, z. B. die Vereinbarung mit der Kundin.");
  if (input.endsOn && input.endsOn < input.today) throw new DunningHoldError("Das Ende liegt in der Vergangenheit.");
  const o = (await client.query(`select status from app.orders where id = $1 for update`, [input.orderId])).rows[0];
  if (!o) throw new DunningHoldError("Die Bestellung gibt es nicht.");
  if (o.status === "storniert" || o.status === "erstattet") throw new DunningHoldError("Die Bestellung ist storniert oder erstattet.");
  const open = await client.query(
    `select 1 from app.dunning_holds where order_id = $1 and ended_at is null and (ends_on is null or ends_on >= $2)`,
    [input.orderId, input.today],
  );
  if (open.rowCount) throw new DunningHoldError("Die Mahnungen sind schon ausgesetzt. Bitte erst aufheben.");
  await client.query(`insert into app.dunning_holds (order_id, ends_on, reason, created_by) values ($1, $2, $3, $4)`, [
    input.orderId,
    input.endsOn,
    reason,
    input.actor,
  ]);
}

/** Geltende Aussetzung aufheben. Gibt false zurück, wenn keine gilt. */
export async function liftDunningHold(client: pg.ClientBase, input: { orderId: string; actor: string; today: string }): Promise<boolean> {
  const r = await client.query(
    `update app.dunning_holds set ended_at = now(), ended_by = $3
      where order_id = $1 and ended_at is null and (ends_on is null or ends_on >= $2)`,
    [input.orderId, input.today, input.actor],
  );
  return (r.rowCount ?? 0) > 0;
}
