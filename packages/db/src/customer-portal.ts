import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

/**
 * Kundenbereich per E-Mail-Link. Eine Kundin ist die Gruppe aller Kundendatensätze mit derselben
 * E-Mail-Adresse. Der Link gilt PORTAL_LINK_DAYS Tage und mehrfach; in der Datenbank liegt nur der
 * SHA-256-Hash. Anfordern kann man ihn selbst (Seite /konto) oder die Verwaltung schickt ihn.
 * Zu einer unbekannten Adresse passiert nichts, die Seite meldet trotzdem dasselbe.
 */

type Db = pg.Pool | pg.ClientBase;

export const PORTAL_LINK_DAYS = 7;
/** Höchstens so viele selbst angeforderte Links je Adresse und Stunde. */
export const PORTAL_LINKS_PER_HOUR = 3;

const hash = (value: string) => createHash("sha256").update(value).digest();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function requestPortalLink(client: pg.ClientBase, email: string, baseUrl: string, createdBy = "kundin"): Promise<boolean> {
  const key = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) return false;
  const c = (
    await client.query<{ first_name: string | null; last_name: string | null; company_name: string | null }>(
      `select first_name, last_name, company_name from app.customers where lower(email) = $1 order by created_at desc limit 1`,
      [key],
    )
  ).rows[0];
  if (!c) return false;
  if (createdBy === "kundin") {
    const recent = await client.query<{ n: number }>(
      `select count(*)::int n from app.customer_portal_links where email_key = $1 and created_at > now() - interval '1 hour'`,
      [key],
    );
    if (recent.rows[0]!.n >= PORTAL_LINKS_PER_HOUR) return false;
  }
  const t = randomBytes(32).toString("base64url");
  await client.query(
    `insert into app.customer_portal_links (email_key, token_hash, expires_at, created_by) values ($1, $2, now() + $3 * interval '1 day', $4)`,
    [key, hash(t), PORTAL_LINK_DAYS, createdBy],
  );
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name;
  await client.query(`insert into app.mail_outbox (purpose, to_address, subject, body_text) values ('kundenbereich', $1, $2, $3)`, [
    key,
    "Dein Link zum Kundenbereich",
    [
      name ? `Hallo ${name},` : "Hallo,",
      "",
      `hier ist dein Link zum Kundenbereich. Dort siehst du deine Bestellungen und Rechnungen und kannst die Karte für Raten und Abos ändern. Der Link gilt ${PORTAL_LINK_DAYS} Tage:`,
      `${baseUrl}/konto/${t}`,
      "",
      "Wenn du den Link nicht angefordert hast, ignoriere diese E-Mail.",
    ].join("\n"),
  ]);
  return true;
}

/** E-Mail-Adresse (klein) zum Link, oder null, wenn er unbekannt oder abgelaufen ist. */
export async function portalEmail(db: Db, token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const { rows } = await db.query<{ email_key: string }>(
    `select email_key from app.customer_portal_links where token_hash = $1 and expires_at > now()`,
    [hash(token)],
  );
  return rows[0]?.email_key ?? null;
}

export interface PortalInstallment {
  seq: number;
  dueDate: string;
  grossCents: number;
  status: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface PortalOrder {
  id: string;
  createdAt: Date;
  status: string;
  currency: string;
  product: string;
  option: string | null;
  isAbo: boolean;
  endsOn: string | null;
  installments: PortalInstallment[];
  /** Zahlungsweg der Raten und Abos: Karte bei Stripe, PayPal-Abo, Überweisung oder keine gespeichert. */
  payment: "stripe" | "paypal" | "paypal_abo" | "ueberweisung" | "keine";
  /** Karte ändern ist möglich: Stripe-Zahlungen stehen noch aus. */
  canChangeCard: boolean;
}

/** Bestellungen der Kundin im neuen System, neueste zuerst. */
export async function portalOrders(db: Db, emailKey: string): Promise<PortalOrder[]> {
  const { rows } = await db.query(
    `select o.id, o.created_at, o.status, o.currency, p.name product, nullif(po.label, '') option,
            (t.order_item_id is not null) is_abo, t.ends_on::text ends_on,
            exists (select 1 from app.manual_orders m where m.order_id = o.id) manual,
            exists (select 1 from app.thrivecart_takeovers x where x.order_id = o.id and x.route = 'paypal') paypal_abo,
            (select s.provider from app.saved_payment_methods s
              where s.customer_id = o.customer_id and s.revoked_at is null order by s.created_at desc limit 1) provider,
            coalesce((select jsonb_agg(jsonb_build_object('seq', i.seq, 'due', i.due_date, 'gross', i.gross_cents, 'status', i.status,
                                                          'invoice_id', inv.id, 'invoice_number', inv.invoice_number) order by i.seq)
                        from app.order_installments i
                        left join app.invoices inv on inv.id = i.invoice_id and inv.pdf_sha256 is not null
                       where i.order_id = o.id), '[]') installments
       from app.orders o
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       left join app.subscription_terms t on t.order_item_id = it.id
      where lower(c.email) = $1
      order by o.created_at desc`,
    [emailKey],
  );
  return rows.map((r) => {
    const installments: PortalInstallment[] = r.installments.map((i: Record<string, unknown>) => ({
      seq: Number(i.seq),
      dueDate: String(i.due),
      grossCents: Number(i.gross),
      status: String(i.status),
      invoiceId: (i.invoice_id as string | null) ?? null,
      invoiceNumber: (i.invoice_number as string | null) ?? null,
    }));
    const payment: PortalOrder["payment"] = r.manual ? "ueberweisung" : r.paypal_abo ? "paypal_abo" : (r.provider ?? "keine");
    const ended = r.status === "storniert" || r.status === "erstattet";
    const open = installments.some((i) => i.status === "offen" || i.status === "fehlgeschlagen");
    // Nur bei Raten und Abos: Die Karte zählt, wenn noch etwas eingezogen wird.
    const recurring = r.is_abo || installments.length > 1;
    return {
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      currency: r.currency,
      product: r.product,
      option: r.option,
      isAbo: r.is_abo,
      endsOn: r.ends_on,
      installments,
      payment,
      canChangeCard: !ended && open && recurring && (payment === "stripe" || payment === "keine"),
    };
  });
}

/** Abos und Raten, die noch über Thrivecart laufen (nur zur Info im Kundenbereich). */
export async function portalLegacySubscriptions(db: Db, emailKey: string) {
  const { rows } = await db.query<{ product: string | null; status: string; next_payment_at: Date | null }>(
    `select coalesce(p.name, s.source_row->>'item_name') product, lower(s.status) status, s.next_payment_at
       from legacy.thrivecart_subscriptions s left join app.products p on p.id = s.product_id
      where lower(s.email) = $1 and lower(s.status) in ('active', 'paused', 'overdue', 'trial')
        and not exists (select 1 from app.thrivecart_takeovers t where t.subscription_id = s.subscription_id)
      order by s.next_payment_at nulls last`,
    [emailKey],
  );
  return rows;
}

export interface CardChangeTarget {
  orderId: string;
  customerId: string;
  email: string;
  name: string;
  /** Stripe-Kunde, an dem die neue Karte hängen soll (vorhandener bevorzugt). */
  stripeCustomerId: string | null;
  /** Fehlgeschlagene, schon fällige Rate, die nach dem Wechsel gleich eingezogen wird. */
  failedInstallmentId: string | null;
}

/** Bestellung der Kundin, deren Karte sie ändern darf, sonst null. */
export async function cardChangeTarget(db: Db, emailKey: string, orderId: string, today: string): Promise<CardChangeTarget | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const order = (await portalOrders(db, emailKey)).find((o) => o.id === orderId);
  if (!order?.canChangeCard) return null;
  const { rows } = await db.query(
    `select o.customer_id, c.email, coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) as name,
            coalesce(c.stripe_customer_id,
                     (select s.provider_customer from app.saved_payment_methods s
                       where s.customer_id = o.customer_id and s.provider = 'stripe' and s.revoked_at is null and s.provider_customer is not null
                       order by s.created_at desc limit 1)) stripe_customer,
            (select i.id from app.order_installments i where i.order_id = o.id and i.status = 'fehlgeschlagen' and i.due_date <= $2::date
              order by i.seq limit 1) failed
       from app.orders o join app.customers c on c.id = o.customer_id where o.id = $1`,
    [orderId, today],
  );
  const r = rows[0];
  if (!r) return null;
  return { orderId, customerId: r.customer_id, email: r.email, name: r.name, stripeCustomerId: r.stripe_customer, failedInstallmentId: r.failed };
}
