import { CODE_PATTERN, normalizeCode, validateDiscount, DiscountError, type Discount, type DiscountKind, type DiscountScope } from "@idf/core/discount";
import type pg from "pg";
import { canChange, canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

/**
 * Gutscheine (Migration 0022). Angelegt und geändert nur von Admins, sehen dürfen
 * Admins und Prüfer. Eingelöst wird bei der Bestellung (orders.ts), dort wird der
 * Rabatt festgeschrieben. Gelöscht wird nie, nur abgeschaltet.
 */

type Db = pg.Pool | pg.ClientBase;

export class CouponError extends Error {}

export interface CouponInput {
  code: string;
  label: string;
  kind: DiscountKind;
  percentBp: number | null;
  amountCents: number | null;
  scope: DiscountScope;
  allProducts: boolean;
  productIds: string[];
  /** Erster gültiger Tag (Europe/Berlin), YYYY-MM-DD, oder null. */
  validFrom: string | null;
  /** Letzter gültiger Tag (Europe/Berlin), YYYY-MM-DD, oder null. */
  validUntil: string | null;
  maxRedemptions: number | null;
}

export interface CouponRow {
  id: string;
  companyId: string;
  code: string;
  label: string;
  kind: DiscountKind;
  percentBp: number | null;
  amountCents: number | null;
  currency: string;
  scope: DiscountScope;
  allProducts: boolean;
  productIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  active: boolean;
  createdAt: Date;
  /** Einlösungen, die zählen (siehe REDEEMED). */
  redemptions: number;
  /** Rabatt brutto über alle zählenden Einlösungen. */
  discountCents: number;
  /** Mindestens eine Bestellung verweist darauf: Code und Rabatt sind fest. */
  locked: boolean;
}

/**
 * Welche Einlösungen auf das Limit zählen: stornierte Bestellungen nicht, unbezahlte
 * nur einen Tag lang (sonst würden abgebrochene Käufe das Limit aufbrauchen).
 */
const REDEEMED = `(o.status not in ('storniert') and (o.status <> 'offen' or o.created_at > now() - interval '1 day'))`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prüft und vereinheitlicht die Angaben zu einem Gutschein. */
export function checkCoupon(input: CouponInput): CouponInput {
  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code)) {
    throw new CouponError("Der Code darf nur Buchstaben, Ziffern, - und _ enthalten und muss 3 bis 40 Zeichen lang sein, z. B. HERBST20.");
  }
  if (input.kind !== "prozent" && input.kind !== "betrag") throw new CouponError("Bitte die Rabattart wählen.");
  if (input.scope !== "erste" && input.scope !== "alle") throw new CouponError("Bitte angeben, ob der Rabatt nur für die erste oder für alle Zahlungen gilt.");
  const d: Discount = {
    kind: input.kind,
    percentBp: input.kind === "prozent" ? input.percentBp : null,
    amountCents: input.kind === "betrag" ? input.amountCents : null,
    scope: input.scope,
  };
  try {
    validateDiscount(d);
  } catch (err) {
    if (err instanceof DiscountError) throw new CouponError(`${err.message}.`);
    throw err;
  }
  for (const day of [input.validFrom, input.validUntil]) {
    if (day !== null && !DAY.test(day)) throw new CouponError("Bitte gültige Daten für den Zeitraum angeben.");
  }
  if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
    throw new CouponError("Das Ende des Zeitraums liegt vor dem Beginn.");
  }
  if (input.maxRedemptions !== null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)) {
    throw new CouponError("Das Limit muss eine ganze Zahl ab 1 sein, oder leer für unbegrenzt.");
  }
  const productIds = [...new Set(input.productIds.filter((p) => UUID.test(p)))];
  if (!input.allProducts && productIds.length === 0) throw new CouponError("Bitte mindestens ein Produkt wählen oder „Alle Produkte“ ankreuzen.");
  const label = input.label.trim();
  if (label.length > 200) throw new CouponError("Die Bezeichnung ist zu lang (höchstens 200 Zeichen).");
  return {
    code,
    label,
    kind: d.kind,
    percentBp: d.percentBp,
    amountCents: d.amountCents,
    scope: d.scope,
    allProducts: input.allProducts,
    productIds: input.allProducts ? [] : productIds,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    maxRedemptions: input.maxRedemptions,
  };
}

const SELECT = `
  select k.id, k.company_id, k.code, k.label, k.kind, k.percent_bp, k.amount_cents, k.currency, k.scope, k.all_products,
         k.product_ids, (k.valid_from at time zone 'Europe/Berlin')::date::text valid_from,
         ((k.valid_until at time zone 'Europe/Berlin')::date - 1)::text valid_until,
         k.max_redemptions, k.active, k.created_at,
         coalesce(r.n, 0) redemptions, coalesce(r.discount, 0) discount,
         exists (select 1 from app.order_discounts x where x.coupon_id = k.id) locked
    from app.coupons k
    left join lateral (
      select count(*)::int n, sum(d.discount_gross_cents) discount
        from app.order_discounts d join app.orders o on o.id = d.order_id
       where d.coupon_id = k.id and ${REDEEMED}) r on true`;

function toRow(r: Record<string, any>): CouponRow {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    label: r.label,
    kind: r.kind,
    percentBp: r.percent_bp,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    currency: r.currency,
    scope: r.scope,
    allProducts: r.all_products,
    productIds: r.product_ids,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    maxRedemptions: r.max_redemptions,
    active: r.active,
    createdAt: r.created_at,
    redemptions: Number(r.redemptions),
    discountCents: Number(r.discount),
    locked: r.locked,
  };
}

export async function listCoupons(db: Db, user: SessionUser): Promise<CouponRow[]> {
  if (!canSeeAll(user)) throw new CouponError("Keine Berechtigung");
  const { rows } = await db.query(`${SELECT} order by k.active desc, k.created_at desc`);
  return rows.map(toRow);
}

export async function getCoupon(db: Db, user: SessionUser, id: string): Promise<CouponRow | null> {
  if (!canSeeAll(user)) throw new CouponError("Keine Berechtigung");
  if (!UUID.test(id)) return null;
  const { rows } = await db.query(`${SELECT} where k.id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Bestellungen mit diesem Gutschein, neueste zuerst. */
export async function couponRedemptions(db: Db, user: SessionUser, couponId: string) {
  if (!canSeeAll(user)) throw new CouponError("Keine Berechtigung");
  const { rows } = await db.query(
    `select o.id order_id, o.created_at, o.status, o.currency, d.list_gross_cents, d.discount_gross_cents,
            coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) customer_name, p.name product
       from app.order_discounts d
       join app.orders o on o.id = d.order_id
       join app.customers c on c.id = o.customer_id
       join app.order_items it on it.id = d.order_item_id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
      where d.coupon_id = $1
      order by o.created_at desc
      limit 200`,
    [couponId],
  );
  return rows.map((r) => ({
    orderId: r.order_id as string,
    createdAt: r.created_at as Date,
    status: r.status as string,
    currency: r.currency as string,
    listCents: Number(r.list_gross_cents),
    discountCents: Number(r.discount_gross_cents),
    customerName: r.customer_name as string,
    product: r.product as string,
  }));
}

async function defaultCompany(c: pg.ClientBase): Promise<string> {
  const { rows } = await c.query<{ id: string }>(`select id from app.companies order by created_at limit 2`);
  if (rows.length !== 1) throw new CouponError(rows.length ? "Mehrere Gesellschaften: bitte Gesellschaft wählen." : "Es ist noch keine Gesellschaft angelegt.");
  return rows[0]!.id;
}

function mapUnique(err: unknown): never {
  if ((err as { code?: string }).code === "23505") throw new CouponError("Diesen Code gibt es schon. Bitte einen anderen wählen.");
  if ((err as { code?: string }).code === "P0001") throw new CouponError("Der Gutschein wurde schon eingelöst: Code, Rabatt und Geltung lassen sich nicht mehr ändern.");
  throw err;
}

export async function createCoupon(c: pg.ClientBase, user: SessionUser, companyId: string | null, input: CouponInput): Promise<string> {
  if (!canChange(user)) throw new CouponError("Keine Berechtigung");
  const v = checkCoupon(input);
  const company = companyId ?? (await defaultCompany(c));
  await c.query("savepoint coupon_create");
  try {
    const { rows } = await c.query<{ id: string }>(
      `insert into app.coupons (company_id, code, label, kind, percent_bp, amount_cents, scope, all_products, product_ids,
         valid_from, valid_until, max_redemptions, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[],
         ($10::date)::timestamp at time zone 'Europe/Berlin', ($11::date + 1)::timestamp at time zone 'Europe/Berlin', $12, $13)
       returning id`,
      [company, v.code, v.label, v.kind, v.percentBp, v.amountCents, v.scope, v.allProducts, v.productIds, v.validFrom, v.validUntil, v.maxRedemptions, user.id],
    );
    await c.query("release savepoint coupon_create");
    return rows[0]!.id;
  } catch (err) {
    await c.query("rollback to savepoint coupon_create");
    mapUnique(err);
  }
}

export async function updateCoupon(c: pg.ClientBase, user: SessionUser, id: string, input: CouponInput): Promise<void> {
  if (!canChange(user)) throw new CouponError("Keine Berechtigung");
  const v = checkCoupon(input);
  await c.query("savepoint coupon_update");
  try {
    const r = await c.query(
      `update app.coupons set code = $2, label = $3, kind = $4, percent_bp = $5, amount_cents = $6, scope = $7,
              all_products = $8, product_ids = $9::uuid[],
              valid_from = ($10::date)::timestamp at time zone 'Europe/Berlin',
              valid_until = ($11::date + 1)::timestamp at time zone 'Europe/Berlin',
              max_redemptions = $12
        where id = $1`,
      [id, v.code, v.label, v.kind, v.percentBp, v.amountCents, v.scope, v.allProducts, v.productIds, v.validFrom, v.validUntil, v.maxRedemptions],
    );
    await c.query("release savepoint coupon_update");
    if (!r.rowCount) throw new CouponError("Gutschein nicht gefunden.");
  } catch (err) {
    await c.query("rollback to savepoint coupon_update");
    if (err instanceof CouponError) throw err;
    mapUnique(err);
  }
}

export async function setCouponActive(c: pg.ClientBase, user: SessionUser, id: string, active: boolean): Promise<void> {
  if (!canChange(user)) throw new CouponError("Keine Berechtigung");
  await c.query(`update app.coupons set active = $2 where id = $1`, [id, active]);
}

export interface ApplicableCoupon {
  id: string;
  code: string;
  discount: Discount;
  currency: string;
}

export type CouponCheck = { ok: true; coupon: ApplicableCoupon } | { ok: false; message: string };

/**
 * Prüft, ob ein Code für diese Preisoption jetzt einlösbar ist. Mit lock = true wird
 * der Gutschein für die laufende Transaktion gesperrt, damit das Limit auch bei
 * gleichzeitigen Käufen hält. Die Meldungen sind für die Kundin geschrieben.
 */
export async function findCoupon(db: Db, rawCode: string, priceOptionId: string, opts: { lock?: boolean } = {}): Promise<CouponCheck> {
  const code = normalizeCode(rawCode);
  const unknown = { ok: false as const, message: "Diesen Gutscheincode kennen wir nicht." };
  if (!CODE_PATTERN.test(code) || !UUID.test(priceOptionId)) return unknown;
  const { rows } = await db.query(
    `select k.id, k.code, k.kind, k.percent_bp, k.amount_cents, k.currency, k.scope, k.active, k.max_redemptions,
            (k.valid_from <= now()) is not false started, (k.valid_until > now()) is not false running,
            (k.all_products or p.id = any(k.product_ids)) fits_product, po.currency option_currency
       from app.price_options po
       join app.products p on p.id = po.product_id
       join app.coupons k on k.company_id = p.company_id and k.code = $1
      where po.id = $2
      ${opts.lock ? "for update of k" : ""}`,
    [code, priceOptionId],
  );
  const k = rows[0];
  if (!k || !k.active) return unknown;
  if (!k.started) return { ok: false, message: "Dieser Gutschein gilt noch nicht." };
  if (!k.running) return { ok: false, message: "Dieser Gutschein ist abgelaufen." };
  if (!k.fits_product) return { ok: false, message: "Dieser Gutschein gilt nicht für dieses Angebot." };
  if (k.kind === "betrag" && k.currency !== k.option_currency) return { ok: false, message: "Dieser Gutschein gilt nicht für dieses Angebot." };
  if (k.max_redemptions !== null) {
    const used = await db.query<{ n: number }>(
      `select count(*)::int n from app.order_discounts d join app.orders o on o.id = d.order_id where d.coupon_id = $1 and ${REDEEMED}`,
      [k.id],
    );
    if (used.rows[0]!.n >= k.max_redemptions) return { ok: false, message: "Dieser Gutschein ist bereits vollständig eingelöst." };
  }
  return {
    ok: true,
    coupon: {
      id: k.id,
      code: k.code,
      currency: k.currency,
      discount: { kind: k.kind, percentBp: k.percent_bp, amountCents: k.amount_cents === null ? null : Number(k.amount_cents), scope: k.scope },
    },
  };
}
