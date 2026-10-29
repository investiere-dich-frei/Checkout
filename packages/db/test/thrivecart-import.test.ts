import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  CATALOG_FORMAT,
  importCatalog,
  mapOption,
  parseCatalog,
  toCents,
  type Catalog,
  type CatalogOption,
  type CatalogProduct,
} from "../src/thrivecart-import.ts";
import { createTestDb, seed, tx, type Fixture, type TestDb } from "./helpers.ts";

// Ausgedachte Produkte im Format des Exports, keine echten Daten.
function option(o: Partial<CatalogOption> & Pick<CatalogOption, "option_id">): CatalogOption {
  return {
    name: `Option ${o.option_id}`,
    mode: "single",
    first_payment: 100,
    rebills: null,
    recurring_payment: null,
    trial_days: null,
    ...o,
  };
}

function product(p: Partial<CatalogProduct> & Pick<CatalogProduct, "thrivecart_product_id">): CatalogProduct {
  return {
    name: `Produkt ${p.thrivecart_product_id}`,
    label: null,
    slug: `produkt-${p.thrivecart_product_id}`,
    status: "live",
    currency: "EUR",
    upsell_ids: [],
    downsell_ids: [],
    refs: {},
    tax: null,
    options: [],
    ...p,
  };
}

function catalog(products: CatalogProduct[]): Catalog {
  return { format: CATALOG_FORMAT, exported_at: "2026-10-29T00:00:00Z", source: "test", products };
}

const sample = () =>
  catalog([
    product({
      thrivecart_product_id: 1,
      name: "Coaching Beispiel",
      refs: { hubspot_product: "Coaching" },
      tax: [
        { country: "AT", rate: "0.2000", exempt_reason: null, source: "Test" },
        { country: "DE", rate: "0.0000", exempt_reason: "Steuerfrei nach § 4 Nr. 21 a) bb) UStG.", source: "Test" },
      ],
      options: [
        option({ option_id: "10", first_payment: 4997 }),
        option({ option_id: "11", mode: "sub_month", first_payment: "1665.67", rebills: 2, recurring_payment: "1665.67" }),
      ],
    }),
    product({ thrivecart_product_id: 2, status: "disabled" }),
  ]);

describe("Thrivecart: Zahlpläne", () => {
  it("rechnet Euro-Beträge exakt in Cent um", () => {
    assert.equal(toCents("1665.67"), 166567);
    assert.equal(toCents(31.09), 3109);
    assert.equal(toCents("4997"), 499700);
    assert.equal(toCents("0.5"), 50);
    assert.throws(() => toCents("12,50"), /Ungültiger Betrag/);
  });

  it("erkennt Einmalzahlung", () => {
    assert.deepEqual(mapOption(option({ option_id: "1", first_payment: "37.00" })), {
      kind: "einmal",
      amountCents: 3700,
      recurringAmountCents: null,
      recurringCount: null,
      intervalMonths: null,
      installments: null,
      trialDays: null,
    });
  });

  it("erkennt Abo ohne Ende", () => {
    const plan = mapOption(option({ option_id: "1", mode: "sub_year", first_payment: 999, rebills: 0, recurring_payment: 999 }));
    assert.equal(plan.kind, "abo");
    assert.equal(plan.intervalMonths, 12);
    assert.equal(plan.recurringCount, null);
  });

  it("erkennt Raten: erste Zahlung plus Folgezahlungen", () => {
    const plan = mapOption(option({ option_id: "1", mode: "sub_month", first_payment: 59, rebills: 11, recurring_payment: 59 }));
    assert.equal(plan.kind, "raten");
    assert.equal(plan.installments, 12);
    assert.equal(plan.recurringCount, 11);
  });

  it("erkennt Raten nach einer Probezeit ohne erste Zahlung", () => {
    const plan = mapOption(
      option({ option_id: "1", mode: "sub_3month", first_payment: 0, rebills: 2, recurring_payment: "2498.50", trial_days: 42 }),
    );
    assert.equal(plan.kind, "raten");
    assert.equal(plan.installments, 2);
    assert.equal(plan.intervalMonths, 3);
    assert.equal(plan.trialDays, 42);
  });

  it("erkennt Anzahlung mit abweichenden Folgeraten", () => {
    const plan = mapOption(
      option({ option_id: "1", mode: "sub_month", first_payment: 1000, rebills: 4, recurring_payment: "999.30", trial_days: 30 }),
    );
    assert.equal(plan.kind, "anzahlung");
    assert.equal(plan.amountCents, 100000);
    assert.equal(plan.recurringAmountCents, 99930);
    assert.equal(plan.recurringCount, 4);
    assert.equal(plan.installments, null);
  });

  it("lehnt unbekannte Zahlungsmodi vor dem Schreiben ab", () => {
    const c = catalog([product({ thrivecart_product_id: 1, options: [option({ option_id: "1", mode: "sub_week" })] })]);
    assert.throws(() => parseCatalog(c), /unbekannter Zahlungsmodus/);
    assert.throws(() => parseCatalog({ format: "anders", products: [] }), /Exportformat/);
  });
});

describe("Thrivecart: Import in die Datenbank", () => {
  let db: TestDb;
  let f: Fixture;

  before(async () => {
    db = await createTestDb();
    f = await seed(db.pool);
  });
  after(() => db.drop());

  it("übernimmt Produkte und Preisoptionen, aber noch nicht verkaufbar", async () => {
    const stats = await tx(db.pool, (c) => importCatalog(c, sample(), f.companyId));
    assert.deepEqual(stats, {
      productsInserted: 2,
      productsUpdated: 0,
      optionsInserted: 2,
      optionsUpdated: 0,
      optionsDeactivated: 0,
    });

    const p = (await db.pool.query(`select * from app.products where thrivecart_product_id = 1`)).rows[0];
    assert.equal(p.active, false);
    assert.equal(p.tax_category, "steuerfrei_4_21");
    assert.equal(p.tax_confirmed_at, null);
    assert.equal(p.external_refs.hubspot_product, "Coaching");

    const opts = (
      await db.pool.query(
        `select thrivecart_option_id, kind, amount_cents, installments, recurring_count, amount_basis
           from app.price_options where product_id = $1 order by thrivecart_option_id`,
        [p.id],
      )
    ).rows;
    assert.deepEqual(opts, [
      { thrivecart_option_id: "10", kind: "einmal", amount_cents: "499700", installments: null, recurring_count: null, amount_basis: "netto" },
      { thrivecart_option_id: "11", kind: "raten", amount_cents: "166567", installments: 3, recurring_count: 2, amount_basis: "netto" },
    ]);
  });

  it("ist wiederholbar, ohne etwas zu ändern oder zu protokollieren", async () => {
    const before = (await db.pool.query(`select count(*)::int n from app.audit_log`)).rows[0].n;
    const stats = await tx(db.pool, (c) => importCatalog(c, sample(), f.companyId));
    assert.deepEqual(stats, {
      productsInserted: 0,
      productsUpdated: 0,
      optionsInserted: 0,
      optionsUpdated: 0,
      optionsDeactivated: 0,
    });
    const afterCount = (await db.pool.query(`select count(*)::int n from app.audit_log`)).rows[0].n;
    assert.equal(afterCount, before);
  });

  it("protokolliert den Import als handelnde Stelle im Audit-Log", async () => {
    const { rows } = await db.pool.query(
      `select distinct actor from app.audit_log where table_name in ('products', 'price_options')`,
    );
    assert.deepEqual(rows, [{ actor: "system:thrivecart-import" }]);
  });

  it("schaltet Optionen ab, die Thrivecart nicht mehr anbietet, statt sie zu löschen", async () => {
    const c = sample();
    c.products[0]!.options = c.products[0]!.options.slice(0, 1);
    const stats = await tx(db.pool, (cl) => importCatalog(cl, c, f.companyId));
    assert.equal(stats.optionsDeactivated, 1);
    const { rows } = await db.pool.query(
      `select active from app.price_options where thrivecart_option_id = '11'`,
    );
    assert.deepEqual(rows, [{ active: false }]);
  });

  it("verkauft ein Produkt erst nach bestätigter Steuerkategorie", async () => {
    await assert.rejects(
      db.pool.query(`update app.products set active = true where thrivecart_product_id = 1`),
      /products_active_needs_tax_confirmation/,
    );
    const admin = (
      await db.pool.query(
        `insert into app.users (email, display_name, role) values ('admin@example.org', 'Admin', 'admin') returning id`,
      )
    ).rows[0].id;
    await db.pool.query(
      `update app.products set tax_category = 'standard', tax_confirmed_at = now(), tax_confirmed_by = $1, active = true
        where thrivecart_product_id = 1`,
      [admin],
    );
  });

  it("überschreibt eine bestätigte Steuerkategorie nicht", async () => {
    await tx(db.pool, (c) => importCatalog(c, sample(), f.companyId));
    const p = (await db.pool.query(`select tax_category, active from app.products where thrivecart_product_id = 1`)).rows[0];
    assert.deepEqual(p, { tax_category: "standard", active: true });
  });
});
