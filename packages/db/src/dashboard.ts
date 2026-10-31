import { splitAmount, type AmountBasis, type PricePlan } from "@idf/core/pricing";
import type pg from "pg";
import { canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

/**
 * Kennzahlen für das Dashboard der Verwaltung, wie im Thrivecart-Dashboard.
 *
 * Grundlage sind die Belege: Umsatz = ausgestellte Rechnungen (Rechnungsdatum),
 * Erstattungen = Stornorechnungen. So stimmen Dashboard und Buchhaltung überein.
 * Neue Verkäufe sind erste Zahlungen einer Bestellung, Folgezahlungen sind Raten
 * und Abo-Verlängerungen. Tage gelten in Europe/Berlin, Beträge brutto in Cent
 * (die Kasse verkauft in EUR).
 *
 * Vertrieb und Freelancer sehen nur Bestellungen über ihre eigenen Kauflinks.
 */

type Db = pg.Pool | pg.ClientBase;

export interface Range {
  /** Erster Tag, YYYY-MM-DD (einschließlich). */
  from: string;
  /** Letzter Tag, YYYY-MM-DD (einschließlich). */
  to: string;
}

export interface Summary {
  revenueCents: number;
  revenueNetCents: number;
  payments: number;
  newSales: number;
  newSalesCents: number;
  rebills: number;
  rebillsCents: number;
  refunds: number;
  refundsCents: number;
  failedPayments: number;
  failedPaymentsCents: number;
  startedUnpaid: number;
  couponOrders: number;
  couponDiscountCents: number;
}

export interface Dashboard {
  range: Range;
  previous: Range;
  current: Summary;
  before: Summary;
  /** Umsatz und Erstattungen je Tag oder je Monat (bei Zeiträumen über 62 Tage). */
  series: { bucket: string; revenueCents: number; refundsCents: number }[];
  bucket: "tag" | "monat";
  topProducts: { name: string; sales: number; revenueCents: number }[];
  byCountry: { country: string; revenueCents: number }[];
  /** Nur für Admin und Prüfung. */
  bySeller: { seller: string; sales: number; revenueCents: number }[] | null;
  /** Stand heute, unabhängig vom Zeitraum. */
  now: {
    activeSubscriptions: number;
    /** Monatlich wiederkehrender Umsatz der laufenden Abos, brutto. */
    mrrCents: number;
    activePlans: number;
    plansOutstandingCents: number;
    overdue: number;
    overdueCents: number;
  };
  /** Altdaten aus Thrivecart im Zeitraum (bis zum Import); nur für Admin und Prüfung. */
  legacy: { invoices: number; revenueCents: number } | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayToUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}
function utcToDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function daysBetween(range: Range): number {
  return Math.round((dayToUtc(range.to).getTime() - dayToUtc(range.from).getTime()) / 86400000) + 1;
}

/** Gleich langer Zeitraum direkt davor, für den Vergleich. */
export function previousRange(range: Range): Range {
  const n = daysBetween(range);
  const to = new Date(dayToUtc(range.from).getTime() - 86400000);
  const from = new Date(to.getTime() - (n - 1) * 86400000);
  return { from: utcToDay(from), to: utcToDay(to) };
}

export type Preset = "heute" | "7" | "30" | "monat" | "vormonat" | "jahr" | "90" | "365";

export const PRESETS: Record<Preset, string> = {
  heute: "Heute",
  "7": "Letzte 7 Tage",
  "30": "Letzte 30 Tage",
  monat: "Dieser Monat",
  vormonat: "Letzter Monat",
  "90": "Letzte 90 Tage",
  jahr: "Dieses Jahr",
  "365": "Letzte 12 Monate",
};

/** Zeitraum zu einer Auswahl, bezogen auf den heutigen Tag. */
export function presetRange(preset: Preset, today: string): Range {
  const t = dayToUtc(today);
  const back = (days: number) => utcToDay(new Date(t.getTime() - days * 86400000));
  const [y, m] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "heute":
      return { from: today, to: today };
    case "7":
      return { from: back(6), to: today };
    case "30":
      return { from: back(29), to: today };
    case "90":
      return { from: back(89), to: today };
    case "365":
      return { from: back(364), to: today };
    case "monat":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "vormonat": {
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      return { from: utcToDay(first), to: utcToDay(last) };
    }
    case "jahr":
      return { from: `${y}-01-01`, to: today };
  }
}

/** Prüft einen frei gewählten Zeitraum; höchstens 5 Jahre. */
export function checkRange(range: Range): Range | null {
  if (!DAY.test(range.from) || !DAY.test(range.to) || range.from > range.to) return null;
  if (Number.isNaN(dayToUtc(range.from).getTime()) || Number.isNaN(dayToUtc(range.to).getTime())) return null;
  if (daysBetween(range) > 366 * 5) return null;
  return range;
}

// Bestellungen, die die Person sehen darf. $3 = sieht alles, $4 = Person.
const SCOPE = `($3::boolean or o.seller_user_id = $4)`;

async function summary(db: Db, range: Range, all: boolean, userId: string): Promise<Summary> {
  const p = [range.from, range.to, all, userId];
  const [inv, failed, started, coupons] = await Promise.all([
    db.query(
      `select
         coalesce(sum(i.gross_cents) filter (where i.kind = 'rechnung'), 0) revenue,
         coalesce(sum(i.net_cents) filter (where i.kind = 'rechnung'), 0) revenue_net,
         count(*) filter (where i.kind = 'rechnung') payments,
         count(*) filter (where i.kind = 'rechnung' and coalesce(x.seq, 1) = 1) new_sales,
         coalesce(sum(i.gross_cents) filter (where i.kind = 'rechnung' and coalesce(x.seq, 1) = 1), 0) new_sales_cents,
         count(*) filter (where i.kind = 'rechnung' and x.seq > 1) rebills,
         coalesce(sum(i.gross_cents) filter (where i.kind = 'rechnung' and x.seq > 1), 0) rebills_cents,
         count(*) filter (where i.kind = 'storno') refunds,
         coalesce(-sum(i.gross_cents) filter (where i.kind = 'storno'), 0) refunds_cents
       from app.invoices i
       join app.orders o on o.id = i.order_id
       left join app.order_installments x on x.invoice_id = i.id
      where i.issue_date between $1 and $2 and ${SCOPE}`,
      p,
    ),
    db.query(
      `select count(*) n, coalesce(sum(i.gross_cents), 0) cents
         from app.order_installments i
         join app.orders o on o.id = i.order_id
        where ${SCOPE} and exists (
          select 1 from app.charge_attempts a
           where a.installment_id = i.id and a.outcome = 'abgelehnt'
             and (a.attempted_at at time zone 'Europe/Berlin')::date between $1 and $2)`,
      p,
    ),
    db.query(
      `select count(*) n from app.orders o
        where (o.created_at at time zone 'Europe/Berlin')::date between $1 and $2 and o.status = 'offen' and ${SCOPE}`,
      p,
    ),
    db.query(
      `select count(*) n, coalesce(sum(d.discount_gross_cents), 0) cents
         from app.order_discounts d join app.orders o on o.id = d.order_id
        where (o.created_at at time zone 'Europe/Berlin')::date between $1 and $2 and o.status <> 'offen' and o.status <> 'storniert' and ${SCOPE}`,
      p,
    ),
  ]);
  const r = inv.rows[0];
  return {
    revenueCents: Number(r.revenue),
    revenueNetCents: Number(r.revenue_net),
    payments: Number(r.payments),
    newSales: Number(r.new_sales),
    newSalesCents: Number(r.new_sales_cents),
    rebills: Number(r.rebills),
    rebillsCents: Number(r.rebills_cents),
    refunds: Number(r.refunds),
    refundsCents: Number(r.refunds_cents),
    failedPayments: Number(failed.rows[0].n),
    failedPaymentsCents: Number(failed.rows[0].cents),
    startedUnpaid: Number(started.rows[0].n),
    couponOrders: Number(coupons.rows[0].n),
    couponDiscountCents: Number(coupons.rows[0].cents),
  };
}

export async function dashboard(db: Db, user: SessionUser, range: Range, today: string): Promise<Dashboard> {
  const all = canSeeAll(user);
  const previous = previousRange(range);
  const p = [range.from, range.to, all, user.id];
  const bucket: Dashboard["bucket"] = daysBetween(range) > 62 ? "monat" : "tag";
  const step = bucket === "monat" ? "1 month" : "1 day";
  const trunc = bucket === "monat" ? "month" : "day";

  const [current, before, series, top, countries, sellers, subs, plans, overdue, legacy] = await Promise.all([
    summary(db, range, all, user.id),
    summary(db, previous, all, user.id),
    db.query(
      `select to_char(b.bucket, 'YYYY-MM-DD') bucket,
              coalesce(sum(i.gross_cents) filter (where i.kind = 'rechnung'), 0) revenue,
              coalesce(-sum(i.gross_cents) filter (where i.kind = 'storno'), 0) refunds
         from generate_series(date_trunc('${trunc}', $1::date), $2::date, interval '${step}') b(bucket)
         left join (app.invoices i join app.orders o on o.id = i.order_id and ${SCOPE})
           on date_trunc('${trunc}', i.issue_date) = b.bucket and i.issue_date between $1 and $2
        group by b.bucket order by b.bucket`,
      p,
    ),
    db.query(
      `select p.name, count(*) filter (where coalesce(x.seq, 1) = 1) sales, sum(i.gross_cents) revenue
         from app.invoices i
         join app.orders o on o.id = i.order_id
         join app.order_items it on it.order_id = o.id
         join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
         left join app.order_installments x on x.invoice_id = i.id
        where i.kind = 'rechnung' and i.issue_date between $1 and $2 and ${SCOPE}
        group by p.id, p.name order by revenue desc limit 10`,
      p,
    ),
    db.query(
      `select coalesce(o.buyer_country, '??') country, sum(i.gross_cents) revenue
         from app.invoices i join app.orders o on o.id = i.order_id
        where i.kind = 'rechnung' and i.issue_date between $1 and $2 and ${SCOPE}
        group by 1 order by revenue desc`,
      p,
    ),
    all
      ? db.query(
          `select coalesce(u.display_name, 'ohne Vertrieb') seller, count(*) filter (where coalesce(x.seq, 1) = 1) sales, sum(i.gross_cents) revenue
             from app.invoices i
             join app.orders o on o.id = i.order_id
             left join app.users u on u.id = o.seller_user_id
             left join app.order_installments x on x.invoice_id = i.id
            where i.kind = 'rechnung' and i.issue_date between $1 and $2
            group by 1 order by revenue desc`,
          [range.from, range.to],
        )
      : null,
    db.query<{ plan: PricePlan; amount_basis: AmountBasis; tax_rate_bp: number }>(
      `select t.plan, t.amount_basis, t.tax_rate_bp
         from app.subscription_terms t join app.orders o on o.id = t.order_id
        where (t.ends_on is null or t.ends_on >= $1::date) and o.status in ('bezahlt', 'teilbezahlt') and ($2::boolean or o.seller_user_id = $3)`,
      [today, all, user.id],
    ),
    db.query(
      `select count(distinct o.id) n, coalesce(sum(i.gross_cents), 0) cents
         from app.orders o
         join app.order_installments i on i.order_id = o.id and i.status in ('offen', 'fehlgeschlagen')
        where o.status = 'teilbezahlt' and not exists (select 1 from app.subscription_terms t where t.order_id = o.id)
          and ($1::boolean or o.seller_user_id = $2)`,
      [all, user.id],
    ),
    db.query(
      `select count(*) n, coalesce(sum(i.gross_cents), 0) cents
         from app.order_installments i join app.orders o on o.id = i.order_id
        where i.status in ('offen', 'fehlgeschlagen') and i.due_date < $1::date and o.status = 'teilbezahlt'
          and ($2::boolean or o.seller_user_id = $3)`,
      [today, all, user.id],
    ),
    all
      ? db.query(
          `select count(*) n, coalesce(sum(gross_cents), 0) cents from legacy.thrivecart_invoices
            where (issued_at at time zone 'Europe/Berlin')::date between $1 and $2`,
          [range.from, range.to],
        )
      : null,
  ]);

  // Monatlicher Umsatz der laufenden Abos: Folgebetrag brutto, auf einen Monat umgerechnet.
  let mrr = 0;
  for (const s of subs.rows) {
    if (s.plan.recurringAmountCents === null || !s.plan.intervalMonths) continue;
    mrr += splitAmount(s.plan.recurringAmountCents, s.amount_basis, s.tax_rate_bp).grossCents / s.plan.intervalMonths;
  }

  return {
    range,
    previous,
    current,
    before,
    bucket,
    series: series.rows.map((r) => ({ bucket: r.bucket, revenueCents: Number(r.revenue), refundsCents: Number(r.refunds) })),
    topProducts: top.rows.map((r) => ({ name: r.name, sales: Number(r.sales), revenueCents: Number(r.revenue) })),
    byCountry: countries.rows.map((r) => ({ country: r.country, revenueCents: Number(r.revenue) })),
    bySeller: sellers ? sellers.rows.map((r) => ({ seller: r.seller, sales: Number(r.sales), revenueCents: Number(r.revenue) })) : null,
    now: {
      activeSubscriptions: subs.rows.length,
      mrrCents: Math.round(mrr),
      activePlans: Number(plans.rows[0].n),
      plansOutstandingCents: Number(plans.rows[0].cents),
      overdue: Number(overdue.rows[0].n),
      overdueCents: Number(overdue.rows[0].cents),
    },
    legacy: legacy ? { invoices: Number(legacy.rows[0].n), revenueCents: Number(legacy.rows[0].cents) } : null,
  };
}
