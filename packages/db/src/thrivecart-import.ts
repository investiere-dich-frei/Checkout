import type pg from "pg";

/**
 * Übernahme des Produktkatalogs aus Thrivecart.
 *
 * Eingabe ist der Export aus thrivecart/export-katalog.sql (Format idf-thrivecart-katalog/1).
 * Der Import ist wiederholbar: Er trifft Produkte und Preisoptionen über ihre
 * Thrivecart-ID und schreibt nur, was sich geändert hat. Er schaltet nie ein
 * Produkt zum Verkauf frei und überschreibt keine bestätigte Steuerkategorie.
 */

export const CATALOG_FORMAT = "idf-thrivecart-katalog/1";
export const IMPORT_ACTOR = "system:thrivecart-import";

type Amount = number | string;

export interface CatalogOption {
  option_id: string;
  name: string;
  mode: string;
  first_payment: Amount;
  rebills: number | null;
  recurring_payment: Amount | null;
  trial_days: number | null;
}

export interface CatalogTax {
  country: string;
  rate: Amount;
  exempt_reason: string | null;
  source: string | null;
}

export interface CatalogProduct {
  thrivecart_product_id: number;
  name: string;
  label: string | null;
  slug: string | null;
  status: string;
  currency: string;
  upsell_ids: unknown[];
  downsell_ids: unknown[];
  refs: Record<string, unknown>;
  tax: CatalogTax[] | null;
  options: CatalogOption[];
}

export interface Catalog {
  format: string;
  exported_at: string;
  source: string;
  products: CatalogProduct[];
}

export type PriceKind = "einmal" | "raten" | "abo" | "anzahlung";

export interface PricePlan {
  kind: PriceKind;
  amountCents: number;
  recurringAmountCents: number | null;
  recurringCount: number | null;
  intervalMonths: number | null;
  installments: number | null;
  trialDays: number | null;
}

export interface ImportStats {
  productsInserted: number;
  productsUpdated: number;
  optionsInserted: number;
  optionsUpdated: number;
  optionsDeactivated: number;
}

const INTERVAL_MONTHS: Record<string, number> = { sub_month: 1, sub_3month: 3, sub_6month: 6, sub_year: 12 };

/** Euro-Betrag aus dem Export in Cent, ohne Rundungsfehler über Gleitkommazahlen. */
export function toCents(value: Amount): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!m) throw new Error(`Ungültiger Betrag: ${JSON.stringify(value)}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

/**
 * Übersetzt eine Thrivecart-Preisoption in einen Zahlplan.
 * Thrivecart zählt mit „rebills“ die Folgezahlungen nach der ersten; 0 heißt unbegrenzt.
 */
export function mapOption(o: CatalogOption): PricePlan {
  const trialDays = o.trial_days && o.trial_days > 0 ? o.trial_days : null;
  const first = toCents(o.first_payment);

  if (o.mode === "single") {
    return {
      kind: "einmal",
      amountCents: first,
      recurringAmountCents: null,
      recurringCount: null,
      intervalMonths: null,
      installments: null,
      trialDays: null,
    };
  }

  const intervalMonths = INTERVAL_MONTHS[o.mode];
  if (intervalMonths === undefined) {
    throw new Error(`Preisoption ${o.option_id}: unbekannter Zahlungsmodus ${o.mode}`);
  }
  if (o.recurring_payment === null) {
    throw new Error(`Preisoption ${o.option_id}: Folgebetrag fehlt`);
  }
  const recurring = toCents(o.recurring_payment);
  const rebills = o.rebills ?? 0;

  if (rebills === 0) {
    return {
      kind: "abo",
      amountCents: first,
      recurringAmountCents: recurring,
      recurringCount: null,
      intervalMonths,
      installments: null,
      trialDays,
    };
  }

  // Gleich hohe Zahlungen sind Raten, auch wenn die erste wegen einer Probezeit entfällt.
  const isInstallments = first === recurring || first === 0;
  return {
    kind: isInstallments ? "raten" : "anzahlung",
    amountCents: first,
    recurringAmountCents: recurring,
    recurringCount: rebills,
    intervalMonths,
    installments: isInstallments ? rebills + (first > 0 ? 1 : 0) : null,
    trialDays,
  };
}

/** Steuerkategorie, wie Thrivecart sie bei deutschen Kundinnen angewendet hat. */
export function mapTax(p: CatalogProduct): { category: "standard" | "steuerfrei_4_21"; source: string } {
  const de = p.tax?.find((t) => t.country === "DE");
  if (!de) {
    return { category: "standard", source: "Thrivecart-Import: keine Angabe, vorläufig mit Umsatzsteuer" };
  }
  const exempt = Number(de.rate) === 0 && /§\s*4\s*Nr\.\s*21/.test(de.exempt_reason ?? "");
  return {
    category: exempt ? "steuerfrei_4_21" : "standard",
    source: `Thrivecart-Import: ${de.source ?? "Satz für DE"}`,
  };
}

export function parseCatalog(raw: unknown): Catalog {
  const c = raw as Catalog;
  if (!c || c.format !== CATALOG_FORMAT || !Array.isArray(c.products)) {
    throw new Error(`Unbekanntes Exportformat, erwartet ${CATALOG_FORMAT}`);
  }
  for (const p of c.products) {
    if (!Number.isInteger(p.thrivecart_product_id) || !p.name) {
      throw new Error(`Produkt ohne ID oder Namen: ${JSON.stringify(p).slice(0, 200)}`);
    }
    // Fehler im Zahlplan sollen vor dem Schreiben auffallen, nicht mittendrin.
    for (const o of p.options) mapOption(o);
  }
  return c;
}

/**
 * Spielt den Katalog ein. Läuft in der Transaktion des Aufrufers; der Aufrufer
 * entscheidet über Commit oder Rollback (Probelauf).
 */
export async function importCatalog(client: pg.ClientBase, catalog: Catalog, companyId: string): Promise<ImportStats> {
  const stats: ImportStats = {
    productsInserted: 0,
    productsUpdated: 0,
    optionsInserted: 0,
    optionsUpdated: 0,
    optionsDeactivated: 0,
  };
  await client.query(`select set_config('app.actor', $1, true)`, [IMPORT_ACTOR]);

  for (const p of catalog.products) {
    const tax = mapTax(p);
    const refs = { ...p.refs, thrivecart_upsell_ids: p.upsell_ids, thrivecart_downsell_ids: p.downsell_ids };

    // Nur geänderte Werte schreiben, damit ein erneuter Lauf das Audit-Log nicht aufbläht.
    // Eine bestätigte Steuerkategorie bleibt, wie sie ist.
    const { rows } = await client.query<{ id: string; inserted: boolean }>(
      `insert into app.products as p (company_id, name, tax_category, active, thrivecart_product_id,
         internal_label, slug, source_status, external_refs, tax_source)
       values ($1, $2, $3, false, $4, $5, $6, $7, $8, $9)
       on conflict (thrivecart_product_id) do update set
         name = excluded.name,
         internal_label = excluded.internal_label,
         slug = excluded.slug,
         source_status = excluded.source_status,
         external_refs = excluded.external_refs,
         tax_category = case when p.tax_confirmed_at is null then excluded.tax_category else p.tax_category end,
         tax_source = case when p.tax_confirmed_at is null then excluded.tax_source else p.tax_source end
       where (p.name, p.internal_label, p.slug, p.source_status, p.external_refs)
               is distinct from (excluded.name, excluded.internal_label, excluded.slug, excluded.source_status, excluded.external_refs)
          or (p.tax_confirmed_at is null
              and (p.tax_category, p.tax_source) is distinct from (excluded.tax_category, excluded.tax_source))
       returning id, (xmax = 0) as inserted`,
      [companyId, p.name, tax.category, p.thrivecart_product_id, p.label, p.slug, p.status, refs, tax.source],
    );
    let productId: string;
    if (rows[0]) {
      productId = rows[0].id;
      if (rows[0].inserted) stats.productsInserted++;
      else stats.productsUpdated++;
    } else {
      const r = await client.query<{ id: string }>(`select id from app.products where thrivecart_product_id = $1`, [
        p.thrivecart_product_id,
      ]);
      productId = r.rows[0]!.id;
    }

    for (const o of p.options) {
      const plan = mapOption(o);
      const { rows: opt } = await client.query<{ inserted: boolean }>(
        `insert into app.price_options as o (product_id, label, kind, currency, amount_cents, installments,
           interval_months, active, thrivecart_option_id, amount_basis, recurring_amount_cents, recurring_count, trial_days)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8, 'netto', $9, $10, $11)
         on conflict (product_id, thrivecart_option_id) do update set
           label = excluded.label, kind = excluded.kind, currency = excluded.currency,
           amount_cents = excluded.amount_cents, installments = excluded.installments,
           interval_months = excluded.interval_months, active = true, amount_basis = excluded.amount_basis,
           recurring_amount_cents = excluded.recurring_amount_cents, recurring_count = excluded.recurring_count,
           trial_days = excluded.trial_days
         where (o.label, o.kind, o.currency, o.amount_cents, o.installments, o.interval_months, o.active,
                o.amount_basis, o.recurring_amount_cents, o.recurring_count, o.trial_days)
               is distinct from
               (excluded.label, excluded.kind, excluded.currency, excluded.amount_cents, excluded.installments,
                excluded.interval_months, true, excluded.amount_basis, excluded.recurring_amount_cents,
                excluded.recurring_count, excluded.trial_days)
         returning (xmax = 0) as inserted`,
        [
          productId,
          o.name,
          plan.kind,
          p.currency,
          plan.amountCents,
          plan.installments,
          plan.intervalMonths,
          o.option_id,
          plan.recurringAmountCents,
          plan.recurringCount,
          plan.trialDays,
        ],
      );
      if (opt[0]?.inserted) stats.optionsInserted++;
      else if (opt[0]) stats.optionsUpdated++;
    }

    // Was Thrivecart nicht mehr anbietet, wird abgeschaltet, nicht gelöscht:
    // Bestellungen können darauf verweisen.
    const gone = await client.query(
      `update app.price_options set active = false
        where product_id = $1 and active and thrivecart_option_id is not null
          and not (thrivecart_option_id = any($2::text[]))`,
      [productId, p.options.map((o) => o.option_id)],
    );
    stats.optionsDeactivated += gone.rowCount ?? 0;
  }
  return stats;
}
