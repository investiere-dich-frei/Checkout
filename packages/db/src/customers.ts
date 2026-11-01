import type pg from "pg";
import { canChange, canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

/**
 * Kundinnen in der Verwaltung. Eine Bestellung legt jeweils einen eigenen Kundendatensatz an,
 * die Altdaten aus Thrivecart ebenfalls. Eine „Kundin“ ist deshalb die Gruppe aller Datensätze
 * mit derselben E-Mail-Adresse (ohne Groß-/Kleinschreibung).
 *
 * Nur Admin und Prüfung sehen Kundinnen; der Vertrieb sieht weiter nur seine Bestellungen.
 * Ändern dürfen nur Admins, und nur Name, Firma, E-Mail und Anschrift. Land und USt-IdNr.
 * bestimmen die Steuer der Bestellung und bleiben, wie bestellt. Ausgestellte Rechnungen
 * behalten ihren Stand (customer_snapshot); jede Änderung steht im Audit-Log.
 */

type Db = pg.Pool | pg.ClientBase;

export class CustomerError extends Error {}

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  country: string;
  orders: number;
  legacyOrders: number;
  lastPurchaseAt: Date | null;
}

const NAME = `coalesce(nullif(c.company_name, ''), nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.email)`;

/** Kundinnen suchen (Name, E-Mail, Firma, Ort). Ohne Suche die zuletzt aktiven. */
export async function listCustomers(db: Db, user: SessionUser, opts: { search?: string; limit?: number; offset?: number } = {}): Promise<CustomerRow[]> {
  if (!canSeeAll(user)) return [];
  const { rows } = await db.query(
    `with g as (
       select lower(c.email) k,
              (array_agg(c.id order by c.created_at desc))[1] id,
              (array_agg(${NAME} order by c.created_at desc))[1] name,
              (array_agg(c.email order by c.created_at desc))[1] email,
              (array_agg(c.country order by c.created_at desc))[1] country,
              array_agg(c.id) ids,
              bool_or($1::text is null
                      or c.email ilike '%' || $1 || '%'
                      or concat_ws(' ', c.first_name, c.last_name, c.company_name) ilike '%' || $1 || '%'
                      or c.city ilike '%' || $1 || '%') hit
         from app.customers c
        group by lower(c.email)
     )
     select g.id, g.name, g.email, g.country,
            (select count(*) from app.orders o where o.customer_id = any(g.ids))::int orders,
            (select count(*) from legacy.thrivecart_orders l where l.customer_id = any(g.ids) or lower(l.email) = g.k)::int legacy_orders,
            greatest((select max(o.created_at) from app.orders o where o.customer_id = any(g.ids)),
                     (select max(l.ordered_at) from legacy.thrivecart_orders l where l.customer_id = any(g.ids) or lower(l.email) = g.k)) last_at
       from g
      where g.hit
      order by last_at desc nulls last, g.name
      limit $2 offset $3`,
    [opts.search?.trim() || null, opts.limit ?? 50, opts.offset ?? 0],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    country: r.country,
    orders: r.orders,
    legacyOrders: r.legacy_orders,
    lastPurchaseAt: r.last_at,
  }));
}

/** Alle Datensätze derselben Kundin (gleiche E-Mail wie der Datensatz `customerId`). */
async function groupIds(db: Db, customerId: string): Promise<{ ids: string[]; key: string } | null> {
  const { rows } = await db.query<{ ids: string[]; k: string }>(
    `select array_agg(c.id) ids, lower(c.email) k from app.customers c
      where lower(c.email) = (select lower(email) from app.customers where id = $1)
      group by lower(c.email)`,
    [customerId],
  );
  return rows[0] ? { ids: rows[0].ids, key: rows[0].k } : null;
}

export async function customerDetail(db: Db, user: SessionUser, customerId: string) {
  if (!canSeeAll(user)) return null;
  const g = await groupIds(db, customerId);
  if (!g) return null;
  const [profile, orders, legacyOrders, legacySubs, totals] = await Promise.all([
    db.query(
      `select id, kind, first_name, last_name, company_name, email, street, postal_code, city, country, vat_id, created_at
         from app.customers where id = any($1) order by created_at desc limit 1`,
      [g.ids],
    ),
    db.query(
      `select o.id, o.created_at, o.status, o.currency, o.total_gross_cents, p.name product, po.label option,
              coalesce((select sum(gross_cents) from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt'), 0) paid,
              (t.order_item_id is not null) is_abo, t.ends_on::text
         from app.orders o
         left join app.order_items it on it.order_id = o.id
         left join app.price_options po on po.id = it.price_option_id
         left join app.products p on p.id = po.product_id
         left join app.subscription_terms t on t.order_item_id = it.id
        where o.customer_id = any($1)
        order by o.created_at desc`,
      [g.ids],
    ),
    db.query(
      `select l.order_id, l.invoice_number, l.ordered_at, coalesce(l.item_name, p.name) product, l.pricing_option_name option,
              l.processor, l.currency, l.gross_cents, l.status
         from legacy.thrivecart_orders l left join app.products p on p.id = l.product_id
        where l.customer_id = any($1) or lower(l.email) = $2
        order by l.ordered_at desc`,
      [g.ids, g.key],
    ),
    db.query(
      `select s.subscription_id, s.invoice_number, s.status, s.processor, s.frequency, s.currency, s.amount_cents,
              s.payments_made, s.payments_remaining, s.total_paid_cents, s.started_at, s.next_payment_at, p.name product
         from legacy.thrivecart_subscriptions s left join app.products p on p.id = s.product_id
        where s.customer_id = any($1) or lower(s.email) = $2
        order by s.started_at desc nulls last`,
      [g.ids, g.key],
    ),
    // Umsatz der neuen Welt: Rechnungen abzüglich Stornorechnungen (Storno ist negativ).
    db.query(`select coalesce(sum(gross_cents), 0) cents from app.invoices where customer_id = any($1)`, [g.ids]),
  ]);
  return {
    profile: profile.rows[0],
    recordCount: g.ids.length,
    orders: orders.rows,
    legacyOrders: legacyOrders.rows,
    legacySubscriptions: legacySubs.rows,
    invoicedCents: Number(totals.rows[0].cents),
  };
}

export interface ContactInput {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email: string;
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Kontaktdaten aller Datensätze der Kundin ändern. Gilt für künftige Rechnungen und Mails;
 * bereits ausgestellte Rechnungen bleiben unverändert. Gibt die Zahl geänderter Datensätze zurück.
 */
export async function updateCustomerContact(client: pg.ClientBase, user: SessionUser, customerId: string, input: ContactInput): Promise<number> {
  if (!canChange(user)) throw new CustomerError("Keine Berechtigung");
  const email = input.email.trim();
  if (!EMAIL.test(email)) throw new CustomerError("Bitte eine gültige E-Mail-Adresse angeben.");
  const v = {
    first_name: clean(input.first_name),
    last_name: clean(input.last_name),
    company_name: clean(input.company_name),
    street: clean(input.street),
    postal_code: clean(input.postal_code),
    city: clean(input.city),
  };
  if (!v.company_name && !v.last_name) throw new CustomerError("Bitte Nachname oder Firma angeben.");
  const g = await groupIds(client, customerId);
  if (!g) throw new CustomerError("Kundin gibt es nicht");
  if (lowerChanged(g.key, email)) {
    // Sonst würden zwei Kundinnen ungewollt zu einer verschmelzen.
    const taken = await client.query(`select 1 from app.customers where lower(email) = lower($1) and not (id = any($2)) limit 1`, [email, g.ids]);
    if (taken.rowCount) throw new CustomerError("Unter dieser E-Mail-Adresse gibt es schon eine andere Kundin.");
  }
  const r = await client.query(
    `update app.customers set first_name = $2, last_name = $3, company_name = $4, email = $5, street = $6, postal_code = $7, city = $8
      where id = any($1)
        and (first_name, last_name, company_name, email, street, postal_code, city)
            is distinct from ($2, $3, $4, $5, $6, $7, $8)`,
    [g.ids, v.first_name, v.last_name, v.company_name, email, v.street, v.postal_code, v.city],
  );
  return r.rowCount ?? 0;
}

const lowerChanged = (key: string, email: string) => key !== email.toLowerCase();

/** Alt-Käufe aus Thrivecart für die Bestellsuche (nur lesen). */
export async function searchLegacyOrders(db: Db, user: SessionUser, search: string, limit = 50) {
  const q = search.trim();
  if (!canSeeAll(user) || !q) return [];
  const { rows } = await db.query(
    `select l.order_id, l.invoice_number, l.ordered_at, l.email, coalesce(l.item_name, p.name) product, l.pricing_option_name option,
            l.currency, l.gross_cents, l.status,
            coalesce(l.customer_id, (select c.id from app.customers c where lower(c.email) = lower(l.email) order by c.created_at desc limit 1)) customer_id
       from legacy.thrivecart_orders l left join app.products p on p.id = l.product_id
      where l.email ilike '%' || $1 || '%' or coalesce(l.item_name, p.name) ilike '%' || $1 || '%'
            or l.order_id::text = $1 or l.invoice_number::text = $1
            or exists (select 1 from app.customers c where c.id = l.customer_id
                        and concat_ws(' ', c.first_name, c.last_name, c.company_name) ilike '%' || $1 || '%')
      order by l.ordered_at desc
      limit $2`,
    [q, limit],
  );
  return rows;
}
