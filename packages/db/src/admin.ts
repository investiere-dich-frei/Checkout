import type pg from "pg";
import type { SessionUser } from "./auth.ts";

/**
 * Abfragen für die Verwaltung. Vertrieb und Freelancer sehen nur Bestellungen über
 * ihre eigenen Kauflinks; Admin und Prüfer (Steuerberatung, Betriebsprüfung) sehen alles.
 */

type Db = pg.Pool | pg.ClientBase;

export const canSeeAll = (u: SessionUser) => u.role === "admin" || u.role === "pruefer";
export const canChange = (u: SessionUser) => u.role === "admin";

export interface OrderRow {
  id: string;
  createdAt: Date;
  status: string;
  customerName: string;
  email: string;
  product: string;
  option: string;
  currency: string;
  totalCents: number;
  paidCents: number;
  seller: string | null;
}

export interface OrderFilter {
  search?: string;
  /** Bestelltag von/bis (Europe/Berlin), YYYY-MM-DD. */
  from?: string;
  to?: string;
  status?: string;
  productId?: string;
  country?: string;
  /** stripe, paypal, ueberweisung (manuelle Bestellung) oder keine (noch nichts bezahlt). */
  payment?: string;
  sellerId?: string;
  /** Lage: ueberfaellig (fällige Rate offen oder fehlgeschlagen), pausiert, abo, raten, einmal. */
  state?: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function listOrders(
  db: Db,
  user: SessionUser,
  opts: OrderFilter & { limit?: number; offset?: number; today?: string } = {},
): Promise<OrderRow[]> {
  const f = (v: string | undefined, re?: RegExp) => (v && v.trim() && (!re || re.test(v.trim())) ? v.trim() : null);
  const { rows } = await db.query(
    `select o.id, o.created_at, o.status, coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) customer_name,
            c.email, p.name product, po.label option, o.currency, o.total_gross_cents,
            coalesce((select sum(gross_cents) from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt'), 0) paid,
            u.display_name seller
       from app.orders o
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       left join app.users u on u.id = o.seller_user_id
      where ($1::boolean or o.seller_user_id = $2)
        and ($3::text is null or c.email ilike '%' || $3 || '%' or p.name ilike '%' || $3 || '%'
             or concat_ws(' ', c.first_name, c.last_name, c.company_name) ilike '%' || $3 || '%' or o.id::text = $3)
        and ($6::date is null or (o.created_at at time zone 'Europe/Berlin')::date >= $6::date)
        and ($7::date is null or (o.created_at at time zone 'Europe/Berlin')::date <= $7::date)
        and ($8::text is null or o.status = $8)
        and ($9::uuid is null or p.id = $9)
        and ($10::text is null or upper(c.country) = upper($10))
        and ($11::text is null
             or ($11 = 'ueberweisung' and exists (select 1 from app.manual_orders m where m.order_id = o.id))
             or ($11 = 'keine' and not exists (select 1 from app.payments pay where pay.order_id = o.id)
                 and not exists (select 1 from app.manual_orders m where m.order_id = o.id))
             or exists (select 1 from app.payments pay where pay.order_id = o.id and pay.provider = $11))
        and ($12::uuid is null or o.seller_user_id = $12)
        and ($13::text is null
             or ($13 = 'ueberfaellig' and o.status not in ('storniert', 'erstattet') and exists (
                   select 1 from app.order_installments i where i.order_id = o.id and i.due_date < $14::date and i.status in ('offen', 'fehlgeschlagen')))
             or ($13 = 'pausiert' and exists (
                   select 1 from app.subscription_pauses sp where sp.order_id = o.id and sp.starts_on <= $14::date
                      and (sp.ends_on is null or sp.ends_on >= $14::date)))
             or ($13 = 'abo' and exists (select 1 from app.subscription_terms t where t.order_id = o.id))
             or ($13 = 'raten' and not exists (select 1 from app.subscription_terms t where t.order_id = o.id)
                 and (select count(*) from app.order_installments i where i.order_id = o.id) > 1)
             or ($13 = 'einmal' and not exists (select 1 from app.subscription_terms t where t.order_id = o.id)
                 and (select count(*) from app.order_installments i where i.order_id = o.id) = 1))
      order by o.created_at desc
      limit $4 offset $5`,
    [
      canSeeAll(user),
      user.id,
      f(opts.search),
      opts.limit ?? 50,
      opts.offset ?? 0,
      f(opts.from, DAY_RE),
      f(opts.to, DAY_RE),
      f(opts.status),
      f(opts.productId, UUID_RE),
      f(opts.country, /^[A-Za-z]{2}$/),
      f(opts.payment),
      canSeeAll(user) ? f(opts.sellerId, UUID_RE) : null,
      f(opts.state),
      opts.today ?? new Date().toISOString().slice(0, 10),
    ],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    customerName: r.customer_name,
    email: r.email,
    product: r.product,
    option: r.option,
    currency: r.currency,
    totalCents: Number(r.total_gross_cents),
    paidCents: Number(r.paid),
    seller: r.seller,
  }));
}

/** Auswahllisten für die Filter der Bestellliste. */
export async function orderFilterOptions(db: Db, user: SessionUser) {
  const [products, sellers, countries] = await Promise.all([
    db.query<{ id: string; name: string }>(
      `select distinct p.id, p.name from app.products p join app.price_options po on po.product_id = p.id
         join app.order_items it on it.price_option_id = po.id join app.orders o on o.id = it.order_id
        where $1::boolean or o.seller_user_id = $2 order by p.name`,
      [canSeeAll(user), user.id],
    ),
    canSeeAll(user)
      ? db.query<{ id: string; display_name: string }>(`select id, display_name from app.users where role in ('admin', 'vertrieb', 'freelancer') order by display_name`)
      : Promise.resolve({ rows: [] as { id: string; display_name: string }[] }),
    db.query<{ country: string }>(
      `select distinct upper(c.country) country from app.orders o join app.customers c on c.id = o.customer_id
        where $1::boolean or o.seller_user_id = $2 order by 1`,
      [canSeeAll(user), user.id],
    ),
  ]);
  return { products: products.rows, sellers: sellers.rows, countries: countries.rows.map((r) => r.country) };
}

export async function orderDetail(db: Db, user: SessionUser, orderId: string) {
  const head = (
    await db.query(
      `select o.*, c.kind customer_kind, c.first_name, c.last_name, c.company_name, c.email, c.street, c.postal_code, c.city,
              c.country, c.vat_id, p.name product, po.label option, po.kind plan_kind, it.tax_rate_bp, it.tax_note,
              u.display_name seller, t.ends_on::text, t.ended_by, (t.order_item_id is not null) is_abo,
              d.code coupon_code, d.coupon_id, d.discount_gross_cents coupon_discount_cents, d.scope coupon_scope,
              exists (select 1 from app.manual_orders m where m.order_id = o.id) is_manual
         from app.orders o
         join app.customers c on c.id = o.customer_id
         join app.order_items it on it.order_id = o.id
         join app.price_options po on po.id = it.price_option_id
         join app.products p on p.id = po.product_id
         left join app.users u on u.id = o.seller_user_id
         left join app.subscription_terms t on t.order_item_id = it.id
         left join app.order_discounts d on d.order_item_id = it.id
        where o.id = $1 and ($2::boolean or o.seller_user_id = $3)`,
      [orderId, canSeeAll(user), user.id],
    )
  ).rows[0];
  if (!head) return null;
  const [installments, invoices, notices, attempts] = await Promise.all([
    db.query(`select id, seq, due_date::text, gross_cents, status from app.order_installments where order_id = $1 order by seq`, [orderId]),
    db.query(
      `select id, invoice_number, kind, corrects_invoice_id, issue_date::text, gross_cents, pdf_sha256 is not null has_pdf
         from app.invoices where order_id = $1 order by number_seq`,
      [orderId],
    ),
    db.query(
      `select n.id, n.kind, n.received_at, n.cancellation_type, n.requested_end::text, r.resolution, r.resolved_at
         from app.contract_notices n left join app.notice_resolutions r on r.notice_id = n.id
        where n.order_id = $1 or r.order_id = $1 order by n.received_at`,
      [orderId],
    ),
    db.query(
      `select a.attempted_at, a.provider, a.outcome, a.error_code, i.seq
         from app.charge_attempts a join app.order_installments i on i.id = a.installment_id
        where i.order_id = $1 order by a.attempted_at`,
      [orderId],
    ),
  ]);
  return { head, installments: installments.rows, invoices: invoices.rows, notices: notices.rows, attempts: attempts.rows };
}

/** Offene Arbeit für Admins: unerledigte Erklärungen, Zahlungen zur Prüfung, erschöpfte Einzüge. */
export async function openWork(db: Db) {
  const [notices, payments, charges] = await Promise.all([
    db.query(
      `select n.id, n.kind, n.received_at, n.full_name, n.email, n.contract_reference, n.cancellation_type, n.requested_end::text,
              n.order_id, n.thrivecart_order_id
         from app.contract_notices n
        where not exists (select 1 from app.notice_resolutions r where r.notice_id = n.id)
        order by n.received_at`,
    ),
    db.query(
      `select 'stripe' provider, id, received_at, outcome_note from app.stripe_events where outcome = 'pruefen'
       union all
       select 'paypal', id, received_at, outcome_note from app.paypal_events where outcome = 'pruefen'
       order by received_at desc limit 100`,
    ),
    db.query(
      `select i.order_id, i.seq, i.due_date::text, i.gross_cents, count(*)::int attempts
         from app.order_installments i join app.charge_attempts a on a.installment_id = i.id
        where i.status = 'fehlgeschlagen'
        group by i.id having count(*) >= 3 order by i.due_date`,
    ),
  ]);
  return { notices: notices.rows, payments: payments.rows, charges: charges.rows };
}

/** Kündigung oder Widerruf als erledigt vermerken. */
export async function resolveNotice(client: pg.ClientBase, user: SessionUser, noticeId: string, resolution: string, orderId: string | null) {
  if (!canChange(user)) throw new Error("Keine Berechtigung");
  await client.query(`insert into app.notice_resolutions (notice_id, resolved_by, resolution, order_id) values ($1, $2, $3, $4)`, [
    noticeId,
    user.id,
    resolution.trim(),
    orderId,
  ]);
}

export interface SellerLink {
  product: string;
  option: string;
  path: string;
}

/** Kauflinks für aktive Angebote mit dem Kürzel der Vertriebsperson. */
export async function sellerLinks(db: Db, user: SessionUser): Promise<SellerLink[]> {
  const { rows } = await db.query<{ product: string; option: string; slug: string; id: string }>(
    `select p.name product, po.label option, p.slug, po.id
       from app.products p join app.price_options po on po.product_id = p.id
      where p.active and po.active and p.slug is not null
      order by p.name, po.label`,
  );
  const v = user.salesCode ? `?v=${encodeURIComponent(user.salesCode)}` : "";
  return rows.map((r) => ({ product: r.product, option: r.option, path: `/kaufen/${r.slug}/${r.id}${v}` }));
}
