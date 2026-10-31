import type { AmountBasis, PricePlan } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
import type pg from "pg";

/** Ein verkaufbares Angebot, wie es der Checkout anzeigt. */
export interface Offer {
  priceOptionId: string;
  productId: string;
  productName: string;
  optionLabel: string;
  currency: string;
  amountBasis: AmountBasis;
  taxCategory: TaxCategory;
  chVatRateBp: number | null;
  /** Zugang ab Kauftag ohne Sofortstart-Häkchen (Masterclass Essential). */
  immediateAccess: boolean;
  plan: PricePlan;
}

export async function getOffer(db: pg.Pool | pg.ClientBase, productSlug: string, priceOptionId: string): Promise<Offer | null> {
  const { rows } = await db.query(
    `select o.id, p.id product_id, p.name, o.label, o.currency, o.amount_basis, p.tax_category, c.ch_vat_rate_bp, p.immediate_access, o.kind,
            o.amount_cents, o.recurring_amount_cents, o.recurring_count, o.interval_months, o.trial_days
       from app.price_options o
       join app.products p on p.id = o.product_id
       join app.companies c on c.id = p.company_id
      where p.slug = $1 and o.id = $2 and p.active and o.active`,
    [productSlug, priceOptionId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    priceOptionId: r.id,
    productId: r.product_id,
    productName: r.name,
    optionLabel: r.label,
    currency: r.currency,
    amountBasis: r.amount_basis,
    taxCategory: r.tax_category,
    chVatRateBp: r.ch_vat_rate_bp,
    immediateAccess: r.immediate_access,
    plan: {
      kind: r.kind,
      amountCents: Number(r.amount_cents),
      recurringAmountCents: r.recurring_amount_cents === null ? null : Number(r.recurring_amount_cents),
      recurringCount: r.recurring_count,
      intervalMonths: r.interval_months,
      trialDays: r.trial_days,
    },
  };
}

export interface LegalTexts {
  agb: { id: string; version: string } | null;
  datenschutz: { id: string; version: string } | null;
  widerruf: { id: string; version: string; content: string } | null;
}

/** Die jeweils gültige Fassung von AGB, Datenschutz und Widerrufsbelehrung. */
export async function currentLegalTexts(db: pg.Pool | pg.ClientBase): Promise<LegalTexts> {
  const { rows } = await db.query(
    `select distinct on (kind) id, kind, version, content
       from app.legal_text_versions
      where valid_from <= now()
      order by kind, valid_from desc`,
  );
  const by = new Map(rows.map((r) => [r.kind, r]));
  const pick = (k: string) => (by.has(k) ? { id: by.get(k).id as string, version: by.get(k).version as string } : null);
  const w = by.get("widerruf");
  return { agb: pick("agb"), datenschutz: pick("datenschutz"), widerruf: w ? { id: w.id, version: w.version, content: w.content } : null };
}

/** Vertriebsperson zum Kürzel im Kauflink, nur wenn aktiv und im Vertrieb. */
export async function findSeller(db: pg.Pool | pg.ClientBase, salesCode: string): Promise<string | null> {
  const { rows } = await db.query(
    `select id from app.users where sales_code = $1 and active and role in ('vertrieb', 'freelancer', 'admin')`,
    [salesCode.toLowerCase()],
  );
  return rows[0]?.id ?? null;
}
