import type { AmountBasis, PriceKind } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
import type pg from "pg";
import { canChange, canSeeAll } from "./admin.ts";
import type { SessionUser } from "./auth.ts";

/**
 * Produktpflege in der Verwaltung: Produkte und Preisoptionen anlegen, ändern,
 * frei- und abschalten. Gelöscht wird nie, weil Bestellungen darauf verweisen.
 *
 * Regeln:
 *  * Nur Admins ändern; Prüferinnen sehen alles, Vertrieb nutzt die Kauflinks.
 *  * Die Steuer je Produkt (Steuerart, § 4 Nr. 21 UStG, brutto/netto je Preisoption)
 *    wird in einem eigenen Schritt ausdrücklich bestätigt (wer und wann steht am Produkt
 *    und im Audit-Log). Jede steuerlich wirksame Änderung (Steuerart, neue oder geänderte
 *    Preisoption) hebt die Bestätigung auf und schaltet das Produkt ab, bis erneut
 *    bestätigt und freigeschaltet ist.
 *  * Eine verkaufte Preisoption bleibt in Bezeichnung, Preis und Zahlplan fest
 *    (Migration 0020). Für einen neuen Preis gibt es eine neue Preisoption.
 */

type Db = pg.Pool | pg.ClientBase;

export class ProductError extends Error {}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRICE_KINDS: readonly PriceKind[] = ["einmal", "raten", "anzahlung", "abo"];
export const TAX_CATEGORIES: readonly TaxCategory[] = ["standard", "steuerfrei_4_21"];

export interface ProductInput {
  name: string;
  slug: string;
  internalLabel: string | null;
  taxCategory: TaxCategory;
  immediateAccess: boolean;
}

export interface PriceOptionInput {
  label: string;
  kind: PriceKind;
  amountBasis: AmountBasis;
  /** Erste Zahlung beim Kauf (bei Abo mit Probezeit auch 0). */
  amountCents: number;
  /** Folgezahlung; nur bei Raten, Anzahlung und Abo. */
  recurringAmountCents: number | null;
  /** Anzahl der Folgezahlungen; nur bei Raten und Anzahlung. */
  recurringCount: number | null;
  intervalMonths: number | null;
  trialDays: number | null;
}

export interface ProductListRow {
  id: string;
  name: string;
  slug: string | null;
  internalLabel: string | null;
  active: boolean;
  taxCategory: TaxCategory;
  taxConfirmed: boolean;
  thrivecartProductId: number | null;
  options: number;
  activeOptions: number;
  orders: number;
}

export interface PriceOptionRow {
  id: string;
  label: string;
  kind: PriceKind;
  currency: string;
  amountBasis: AmountBasis;
  amountCents: number;
  recurringAmountCents: number | null;
  recurringCount: number | null;
  intervalMonths: number | null;
  trialDays: number | null;
  installments: number | null;
  active: boolean;
  thrivecartOptionId: string | null;
  sold: number;
}

export interface ProductDetail {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  slug: string | null;
  internalLabel: string | null;
  active: boolean;
  taxCategory: TaxCategory;
  taxSource: string | null;
  taxConfirmedAt: Date | null;
  taxConfirmedBy: string | null;
  immediateAccess: boolean;
  thrivecartProductId: number | null;
  createdAt: Date;
  options: PriceOptionRow[];
}

function requireChange(user: SessionUser) {
  if (!canChange(user)) throw new ProductError("Keine Berechtigung");
}

function requireView(user: SessionUser) {
  if (!canSeeAll(user)) throw new ProductError("Keine Berechtigung");
}

/** Prüft und vereinheitlicht die Angaben zu einem Produkt. */
export function checkProduct(input: ProductInput): ProductInput {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name) throw new ProductError("Bitte einen Produktnamen angeben.");
  if (name.length > 200) throw new ProductError("Der Produktname ist zu lang (höchstens 200 Zeichen).");
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) {
    throw new ProductError("Die Adresse (Slug) darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten, z. B. finanz-kompass.");
  }
  if (!TAX_CATEGORIES.includes(input.taxCategory)) throw new ProductError("Unbekannte Steuerart.");
  return { name, slug, internalLabel: input.internalLabel?.trim() || null, taxCategory: input.taxCategory, immediateAccess: input.immediateAccess };
}

const isCount = (n: number | null): n is number => n !== null && Number.isInteger(n) && n > 0;
const isCents = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;

/**
 * Prüft eine Preisoption und rechnet die Felder aus, die die Datenbank erwartet.
 * Gleiche Regeln wie beim Thrivecart-Import: Raten sind gleich hohe Zahlungen
 * (oder eine Probezeit ohne erste Zahlung), Anzahlung heißt: erste Zahlung weicht ab.
 */
export function checkPriceOption(input: PriceOptionInput): PriceOptionInput & { installments: number | null } {
  const label = input.label.trim();
  if (!label) throw new ProductError("Bitte eine Bezeichnung für die Preisoption angeben, z. B. „Einmalzahlung“ oder „12 Raten“.");
  if (label.length > 200) throw new ProductError("Die Bezeichnung ist zu lang (höchstens 200 Zeichen).");
  if (!PRICE_KINDS.includes(input.kind)) throw new ProductError("Unbekannte Zahlart.");
  if (input.amountBasis !== "brutto" && input.amountBasis !== "netto") throw new ProductError("Bitte angeben, ob der Preis die Steuer enthält.");
  if (!isCents(input.amountCents)) throw new ProductError("Bitte einen gültigen Betrag für die erste Zahlung angeben.");

  const base = { label, kind: input.kind, amountBasis: input.amountBasis, amountCents: input.amountCents };

  if (input.kind === "einmal") {
    if (input.amountCents === 0) throw new ProductError("Eine Einmalzahlung braucht einen Betrag über 0 €.");
    return { ...base, recurringAmountCents: null, recurringCount: null, intervalMonths: null, trialDays: null, installments: null };
  }

  if (!isCents(input.recurringAmountCents) || input.recurringAmountCents === 0) {
    throw new ProductError("Bitte den Betrag der Folgezahlungen angeben.");
  }
  if (!isCount(input.intervalMonths) || input.intervalMonths > 24) {
    throw new ProductError("Bitte den Abstand der Zahlungen in Monaten angeben (1 bis 24).");
  }
  const trialDays = input.trialDays === null || input.trialDays === 0 ? null : input.trialDays;
  if (trialDays !== null && (!isCount(trialDays) || trialDays > 365)) {
    throw new ProductError("Die Probezeit muss zwischen 1 und 365 Tagen liegen.");
  }
  const plan = { recurringAmountCents: input.recurringAmountCents, intervalMonths: input.intervalMonths, trialDays };

  if (input.kind === "abo") {
    if (input.amountCents === 0 && trialDays === null) {
      throw new ProductError("Ein Abo ohne erste Zahlung braucht eine Probezeit.");
    }
    return { ...base, ...plan, recurringCount: null, installments: null };
  }

  if (!isCount(input.recurringCount) || input.recurringCount > 120) {
    throw new ProductError("Bitte die Anzahl der Folgezahlungen angeben (1 bis 120).");
  }
  if (input.kind === "raten") {
    if (input.amountCents !== 0 && input.amountCents !== input.recurringAmountCents) {
      throw new ProductError("Bei Raten sind alle Zahlungen gleich hoch. Weicht die erste ab, ist es eine Anzahlung.");
    }
    if (input.amountCents === 0 && trialDays === null) {
      throw new ProductError("Raten ohne erste Zahlung brauchen eine Probezeit.");
    }
    return {
      ...base,
      ...plan,
      recurringCount: input.recurringCount,
      installments: input.recurringCount + (input.amountCents > 0 ? 1 : 0),
    };
  }
  // Anzahlung
  if (input.amountCents === 0) throw new ProductError("Bitte den Betrag der Anzahlung angeben.");
  if (input.amountCents === input.recurringAmountCents) {
    throw new ProductError("Anzahlung und Folgezahlungen sind gleich hoch. Bitte als Raten anlegen.");
  }
  return { ...base, ...plan, recurringCount: input.recurringCount, installments: null };
}

function translateDbError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === "23505" && e.constraint === "products_slug_key") {
    throw new ProductError("Diese Adresse (Slug) hat schon ein anderes Produkt. Bitte eine andere wählen.");
  }
  if (e.code === "P0001" && e.message?.includes("ist verkauft")) {
    throw new ProductError("Diese Preisoption wurde schon verkauft. Preis und Zahlplan bleiben fest. Lege eine neue Preisoption an und schalte diese ab.");
  }
  throw err;
}

export async function listProducts(db: Db, user: SessionUser, opts: { search?: string; filter?: "alle" | "aktiv" | "inaktiv" } = {}): Promise<ProductListRow[]> {
  requireView(user);
  const { rows } = await db.query(
    `select p.id, p.name, p.slug, p.internal_label, p.active, p.tax_category, p.tax_confirmed_at is not null tax_confirmed,
            p.thrivecart_product_id,
            (select count(*)::int from app.price_options o where o.product_id = p.id) options,
            (select count(*)::int from app.price_options o where o.product_id = p.id and o.active) active_options,
            (select count(distinct it.order_id)::int from app.order_items it join app.price_options o on o.id = it.price_option_id
              where o.product_id = p.id) orders
       from app.products p
      where ($1::text is null or p.name ilike '%' || $1 || '%' or p.slug ilike '%' || $1 || '%'
             or p.internal_label ilike '%' || $1 || '%' or p.thrivecart_product_id::text = $1)
        and ($2::text = 'alle' or p.active = ($2::text = 'aktiv'))
      order by p.active desc, lower(p.name)`,
    [opts.search?.trim() || null, opts.filter ?? "alle"],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    internalLabel: r.internal_label,
    active: r.active,
    taxCategory: r.tax_category,
    taxConfirmed: r.tax_confirmed,
    thrivecartProductId: r.thrivecart_product_id === null ? null : Number(r.thrivecart_product_id),
    options: r.options,
    activeOptions: r.active_options,
    orders: r.orders,
  }));
}

export async function getProduct(db: Db, user: SessionUser, productId: string): Promise<ProductDetail | null> {
  requireView(user);
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const head = (
    await db.query(
      `select p.*, c.legal_name company_name, u.display_name confirmed_by_name
         from app.products p
         join app.companies c on c.id = p.company_id
         left join app.users u on u.id = p.tax_confirmed_by
        where p.id = $1`,
      [productId],
    )
  ).rows[0];
  if (!head) return null;
  const { rows } = await db.query(
    `select o.*, (select count(*)::int from app.order_items it where it.price_option_id = o.id) sold
       from app.price_options o where o.product_id = $1
      order by o.active desc, o.created_at, o.label`,
    [productId],
  );
  const num = (v: unknown) => (v === null ? null : Number(v));
  return {
    id: head.id,
    companyId: head.company_id,
    companyName: head.company_name,
    name: head.name,
    slug: head.slug,
    internalLabel: head.internal_label,
    active: head.active,
    taxCategory: head.tax_category,
    taxSource: head.tax_source,
    taxConfirmedAt: head.tax_confirmed_at,
    taxConfirmedBy: head.confirmed_by_name,
    immediateAccess: head.immediate_access,
    thrivecartProductId: num(head.thrivecart_product_id),
    createdAt: head.created_at,
    options: rows.map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
      currency: o.currency,
      amountBasis: o.amount_basis,
      amountCents: Number(o.amount_cents),
      recurringAmountCents: num(o.recurring_amount_cents),
      recurringCount: o.recurring_count,
      intervalMonths: o.interval_months,
      trialDays: o.trial_days,
      installments: o.installments,
      active: o.active,
      thrivecartOptionId: o.thrivecart_option_id,
      sold: o.sold,
    })),
  };
}

/** Gesellschaften, für die Produkte angelegt werden können (heute nur die GmbH). */
export async function listCompanies(db: Db): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query(`select id, legal_name from app.companies order by created_at`);
  return rows.map((r) => ({ id: r.id, name: r.legal_name }));
}

/** Legt ein Produkt an. Es ist abgeschaltet und die Steuer unbestätigt. */
export async function createProduct(client: pg.ClientBase, user: SessionUser, companyId: string | null, input: ProductInput): Promise<string> {
  requireChange(user);
  const p = checkProduct(input);
  const companies = await listCompanies(client);
  const company = companyId ? companies.find((c) => c.id === companyId) : companies.length === 1 ? companies[0] : undefined;
  if (!company) throw new ProductError("Bitte die verkaufende Gesellschaft wählen.");
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into app.products (company_id, name, slug, internal_label, tax_category, immediate_access, active, tax_source)
       values ($1, $2, $3, $4, $5, $6, false, 'verwaltung') returning id`,
      [company.id, p.name, p.slug, p.internalLabel, p.taxCategory, p.immediateAccess],
    );
    return rows[0]!.id;
  } catch (err) {
    translateDbError(err);
  }
}

/**
 * Ändert Name, Adresse, Steuerart und Sofortzugang. Eine geänderte Steuerart hebt die
 * Bestätigung auf und schaltet das Produkt ab. Gibt zurück, ob das passiert ist.
 */
export async function updateProduct(client: pg.ClientBase, user: SessionUser, productId: string, input: ProductInput): Promise<{ taxReset: boolean }> {
  requireChange(user);
  const p = checkProduct(input);
  const cur = (await client.query(`select tax_category from app.products where id = $1 for update`, [productId])).rows[0];
  if (!cur) throw new ProductError("Produkt gibt es nicht.");
  const taxReset = cur.tax_category !== p.taxCategory;
  try {
    await client.query(
      `update app.products
          set name = $2, slug = $3, internal_label = $4, immediate_access = $6, tax_category = $5
        where id = $1
          and (name, slug, internal_label, tax_category, immediate_access) is distinct from ($2, $3, $4, $5, $6)`,
      [productId, p.name, p.slug, p.internalLabel, p.taxCategory, p.immediateAccess],
    );
  } catch (err) {
    translateDbError(err);
  }
  if (taxReset) await resetTaxConfirmation(client, productId);
  return { taxReset };
}

/** Hebt die Steuerbestätigung auf und schaltet das Produkt ab (nach steuerlich wirksamer Änderung). */
async function resetTaxConfirmation(client: pg.ClientBase, productId: string) {
  await client.query(
    `update app.products set active = false, tax_source = 'verwaltung', tax_confirmed_at = null, tax_confirmed_by = null
      where id = $1 and (active or tax_confirmed_at is not null)`,
    [productId],
  );
}

/**
 * Bestätigt ausdrücklich die Steuer eines Produkts: Steuerart und brutto/netto je Preisoption,
 * so wie sie gerade gespeichert sind. Die bestätigten Werte werden mitgegeben und müssen
 * zum Stand passen, damit niemand etwas bestätigt, das sich inzwischen geändert hat.
 */
export async function confirmProductTax(
  client: pg.ClientBase,
  user: SessionUser,
  productId: string,
  seen: { taxCategory: TaxCategory; basisByOption: Record<string, AmountBasis> },
): Promise<void> {
  requireChange(user);
  const p = (await client.query(`select tax_category from app.products where id = $1 for update`, [productId])).rows[0];
  if (!p) throw new ProductError("Produkt gibt es nicht.");
  const { rows: opts } = await client.query<{ id: string; amount_basis: AmountBasis }>(
    `select id, amount_basis from app.price_options where product_id = $1`,
    [productId],
  );
  const stale =
    p.tax_category !== seen.taxCategory ||
    opts.length !== Object.keys(seen.basisByOption).length ||
    opts.some((o) => seen.basisByOption[o.id] !== o.amount_basis);
  if (stale) throw new ProductError("Die Angaben haben sich inzwischen geändert. Bitte die Seite neu laden und erneut prüfen.");
  await client.query(
    `update app.products set tax_source = 'verwaltung', tax_confirmed_at = now(), tax_confirmed_by = $2 where id = $1`,
    [productId, user.id],
  );
}

/** Schaltet ein Produkt frei oder ab. Freischalten braucht Adresse, bestätigte Steuer und eine aktive Preisoption. */
export async function setProductActive(client: pg.ClientBase, user: SessionUser, productId: string, active: boolean): Promise<void> {
  requireChange(user);
  const { rows } = await client.query(
    `select p.slug, p.tax_confirmed_at, exists (select 1 from app.price_options o where o.product_id = p.id and o.active) has_option
       from app.products p where p.id = $1 for update`,
    [productId],
  );
  const p = rows[0];
  if (!p) throw new ProductError("Produkt gibt es nicht.");
  if (active) {
    if (!p.slug) throw new ProductError("Vor dem Freischalten braucht das Produkt eine Adresse (Slug).");
    if (!p.tax_confirmed_at) throw new ProductError("Vor dem Freischalten bitte die Steuer bestätigen.");
    if (!p.has_option) throw new ProductError("Vor dem Freischalten braucht das Produkt mindestens eine aktive Preisoption.");
  }
  await client.query(`update app.products set active = $2 where id = $1 and active is distinct from $2`, [productId, active]);
}

export async function createPriceOption(client: pg.ClientBase, user: SessionUser, productId: string, input: PriceOptionInput): Promise<string> {
  requireChange(user);
  const o = checkPriceOption(input);
  const exists = await client.query(`select 1 from app.products where id = $1`, [productId]);
  if (!exists.rowCount) throw new ProductError("Produkt gibt es nicht.");
  const { rows } = await client.query<{ id: string }>(
    `insert into app.price_options (product_id, label, kind, currency, amount_basis, amount_cents, recurring_amount_cents,
                                    recurring_count, interval_months, trial_days, installments, active)
     values ($1, $2, $3, 'EUR', $4, $5, $6, $7, $8, $9, $10, true) returning id`,
    [productId, o.label, o.kind, o.amountBasis, o.amountCents, o.recurringAmountCents, o.recurringCount, o.intervalMonths, o.trialDays, o.installments],
  );
  await resetTaxConfirmation(client, productId);
  return rows[0]!.id;
}

/** Ändert eine Preisoption, solange sie nicht verkauft ist. Gibt die Produkt-ID zurück. */
export async function updatePriceOption(client: pg.ClientBase, user: SessionUser, optionId: string, input: PriceOptionInput): Promise<string> {
  requireChange(user);
  const o = checkPriceOption(input);
  try {
    const { rows } = await client.query<{ product_id: string }>(
      `update app.price_options
          set label = $2, kind = $3, amount_basis = $4, amount_cents = $5, recurring_amount_cents = $6,
              recurring_count = $7, interval_months = $8, trial_days = $9, installments = $10
        where id = $1
          and (label, kind, amount_basis, amount_cents, recurring_amount_cents, recurring_count, interval_months, trial_days, installments)
              is distinct from ($2, $3, $4, $5::bigint, $6::bigint, $7::int, $8::int, $9::int, $10::int)
       returning product_id`,
      [optionId, o.label, o.kind, o.amountBasis, o.amountCents, o.recurringAmountCents, o.recurringCount, o.intervalMonths, o.trialDays, o.installments],
    );
    if (rows[0]) {
      await resetTaxConfirmation(client, rows[0].product_id);
      return rows[0].product_id;
    }
  } catch (err) {
    translateDbError(err);
  }
  const exists = await client.query<{ product_id: string }>(`select product_id from app.price_options where id = $1`, [optionId]);
  if (!exists.rows[0]) throw new ProductError("Preisoption gibt es nicht.");
  return exists.rows[0].product_id;
}

/** Schaltet eine Preisoption ein oder aus. Die letzte aktive Option eines freigeschalteten Produkts bleibt an. */
export async function setPriceOptionActive(client: pg.ClientBase, user: SessionUser, optionId: string, active: boolean): Promise<string> {
  requireChange(user);
  const { rows } = await client.query(
    `select o.product_id, p.active product_active,
            (select count(*)::int from app.price_options x where x.product_id = o.product_id and x.active and x.id <> o.id) others
       from app.price_options o join app.products p on p.id = o.product_id
      where o.id = $1 for update of p`,
    [optionId],
  );
  const r = rows[0];
  if (!r) throw new ProductError("Preisoption gibt es nicht.");
  if (!active && r.product_active && r.others === 0) {
    throw new ProductError("Das ist die letzte aktive Preisoption. Schalte zuerst das Produkt ab oder lege eine andere Preisoption an.");
  }
  await client.query(`update app.price_options set active = $2 where id = $1 and active is distinct from $2`, [optionId, active]);
  return r.product_id;
}
