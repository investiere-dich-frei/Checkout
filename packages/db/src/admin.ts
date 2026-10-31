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

export async function listOrders(db: Db, user: SessionUser, opts: { limit?: number; offset?: number; search?: string } = {}): Promise<OrderRow[]> {
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
      order by o.created_at desc
      limit $4 offset $5`,
    [canSeeAll(user), user.id, opts.search?.trim() || null, opts.limit ?? 50, opts.offset ?? 0],
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

export async function orderDetail(db: Db, user: SessionUser, orderId: string) {
  const head = (
    await db.query(
      `select o.*, c.kind customer_kind, c.first_name, c.last_name, c.company_name, c.email, c.street, c.postal_code, c.city,
              c.country, c.vat_id, p.name product, po.label option, po.kind plan_kind, it.tax_rate_bp, it.tax_note,
              u.display_name seller, t.ends_on::text, t.ended_by, (t.order_item_id is not null) is_abo,
              d.code coupon_code, d.coupon_id, d.discount_gross_cents coupon_discount_cents, d.scope coupon_scope
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
