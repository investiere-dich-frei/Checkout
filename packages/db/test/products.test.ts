import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { getOffer } from "../src/catalog.ts";
import { placeOrder } from "../src/orders.ts";
import {
  checkPriceOption,
  confirmProductTax,
  createPriceOption,
  createProduct,
  getProduct,
  listProducts,
  ProductError,
  setAccessLike,
  setPriceOptionActive,
  setProductActive,
  updatePriceOption,
  updateProduct,
  type PriceOptionInput,
  type ProductInput,
} from "../src/products.ts";
import { enqueueWebhook } from "../src/webhooks.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Personen und Produkte, keine echten Daten.
describe("Produktpflege in der Verwaltung", () => {
  let db: TestDb;
  let admin: SessionUser;
  let pruefer: SessionUser;
  let vertrieb: SessionUser;
  let legal: string[];

  const product: ProductInput = { name: "Test-Kurs", slug: "test-kurs", internalLabel: null, taxCategory: "standard", immediateAccess: false };
  const einmal: PriceOptionInput = {
    label: "Einmalzahlung",
    kind: "einmal",
    amountBasis: "brutto",
    amountCents: 3700,
    recurringAmountCents: null,
    recurringCount: null,
    intervalMonths: null,
    trialDays: null,
  };
  const raten: PriceOptionInput = { ...einmal, label: "3 Raten", kind: "raten", amountCents: 10000, recurringAmountCents: 10000, recurringCount: 2, intervalMonths: 1 };

  const confirm = async (productId: string) => {
    const p = (await getProduct(db.pool, admin, productId))!;
    await tx(db.pool, (c) =>
      confirmProductTax(c, admin, productId, {
        taxCategory: p.taxCategory,
        basisByOption: Object.fromEntries(p.options.map((o) => [o.id, o.amountBasis])),
      }),
    );
  };

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const adminId = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    admin = { id: adminId, email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
    pruefer = { ...admin, role: "pruefer" };
    vertrieb = { ...admin, role: "vertrieb" };
    legal = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
  });
  after(() => db.drop());

  it("prüft Zahlpläne wie der Thrivecart-Import", () => {
    assert.equal(checkPriceOption(raten).installments, 3);
    assert.equal(checkPriceOption({ ...raten, amountCents: 0, trialDays: 14 }).installments, 2);
    assert.throws(() => checkPriceOption({ ...raten, amountCents: 5000 }), /Anzahlung/);
    assert.throws(() => checkPriceOption({ ...einmal, amountCents: 0 }), ProductError);
    const anzahlung = checkPriceOption({ ...raten, kind: "anzahlung", amountCents: 50000 });
    assert.equal(anzahlung.installments, null);
    assert.throws(() => checkPriceOption({ ...raten, kind: "anzahlung" }), /Raten/);
    const abo = checkPriceOption({ ...raten, kind: "abo", recurringCount: 5 });
    assert.equal(abo.recurringCount, null);
    assert.throws(() => checkPriceOption({ ...raten, kind: "abo", amountCents: 0 }), /Probezeit/);
    assert.throws(() => checkPriceOption({ ...raten, intervalMonths: null }), /Abstand/);
    // Einmalzahlung verwirft Angaben zu Folgezahlungen.
    assert.equal(checkPriceOption({ ...einmal, recurringAmountCents: 100, intervalMonths: 1 }).recurringAmountCents, null);
  });

  it("legt ein Produkt unbestätigt und abgeschaltet an, freischalten erst nach Bestätigung", async () => {
    await assert.rejects(tx(db.pool, (c) => createProduct(c, admin, null, { ...product, slug: "Test Kurs" })), /Slug/);
    await assert.rejects(tx(db.pool, (c) => createProduct(c, vertrieb, null, product)), /Berechtigung/);

    const id = await tx(db.pool, (c) => createProduct(c, admin, null, product));
    let p = (await getProduct(db.pool, admin, id))!;
    assert.equal(p.active, false);
    assert.equal(p.taxConfirmedAt, null);
    await assert.rejects(tx(db.pool, (c) => createProduct(c, admin, null, { ...product, name: "Doppelt" })), /schon ein anderes Produkt/);

    await assert.rejects(tx(db.pool, (c) => setProductActive(c, admin, id, true)), /Steuer bestätigen/);
    const optId = await tx(db.pool, (c) => createPriceOption(c, admin, id, einmal));
    await assert.rejects(tx(db.pool, (c) => setProductActive(c, admin, id, true)), /Steuer bestätigen/);

    // Bestätigt wird nur der Stand, den die Person gesehen hat.
    await assert.rejects(
      tx(db.pool, (c) => confirmProductTax(c, admin, id, { taxCategory: "standard", basisByOption: { [optId]: "netto" } })),
      /geändert/,
    );
    await confirm(id);
    await tx(db.pool, (c) => setProductActive(c, admin, id, true));
    p = (await getProduct(db.pool, admin, id))!;
    assert.equal(p.active, true);
    assert.equal(p.taxConfirmedBy, "Admin");
    assert.ok(await getOffer(db.pool, "test-kurs", optId));

    const audit = await db.pool.query(
      `select count(*)::int n from app.audit_log where table_name = 'products' and record_id = $1 and actor is not null`,
      [id],
    );
    assert.ok(audit.rows[0].n >= 3);
  });

  it("hebt die Bestätigung bei steuerlich wirksamer Änderung auf und schaltet ab", async () => {
    const id = await tx(db.pool, (c) => createProduct(c, admin, null, { ...product, slug: "steuer-kurs" }));
    const optId = await tx(db.pool, (c) => createPriceOption(c, admin, id, einmal));
    await confirm(id);
    await tx(db.pool, (c) => setProductActive(c, admin, id, true));

    // Name ändern ist steuerlich egal.
    assert.deepEqual(await tx(db.pool, (c) => updateProduct(c, admin, id, { ...product, slug: "steuer-kurs", name: "Neuer Name" })), { taxReset: false });
    assert.equal((await getProduct(db.pool, admin, id))!.active, true);

    // Steuerart ändern: abgeschaltet, unbestätigt.
    const r = await tx(db.pool, (c) => updateProduct(c, admin, id, { ...product, slug: "steuer-kurs", taxCategory: "steuerfrei_4_21" }));
    assert.deepEqual(r, { taxReset: true });
    let p = (await getProduct(db.pool, admin, id))!;
    assert.equal(p.active, false);
    assert.equal(p.taxConfirmedAt, null);
    assert.equal(await getOffer(db.pool, "steuer-kurs", optId), null);

    await confirm(id);
    await tx(db.pool, (c) => setProductActive(c, admin, id, true));

    // Preisoption ändern (brutto → netto): ebenso.
    await tx(db.pool, (c) => updatePriceOption(c, admin, optId, { ...einmal, amountBasis: "netto" }));
    p = (await getProduct(db.pool, admin, id))!;
    assert.equal(p.active, false);
    assert.equal(p.taxConfirmedAt, null);
    assert.equal(p.options[0]!.amountBasis, "netto");
  });

  it("schreibt verkaufte Preisoptionen fest; nur Abschalten geht", async () => {
    const id = await tx(db.pool, (c) => createProduct(c, admin, null, { ...product, slug: "verkauft" }));
    const optId = await tx(db.pool, (c) => createPriceOption(c, admin, id, raten));
    await confirm(id);
    await tx(db.pool, (c) => setProductActive(c, admin, id, true));
    await tx(db.pool, (c) =>
      placeOrder(c, {
        priceOptionId: optId,
        customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
        vatIdVerified: false,
        sellerUserId: null,
        agbVersionId: legal[0]!,
        privacyVersionId: legal[1]!,
        withdrawalVersionId: legal[2]!,
        withdrawalWaiver: true,
        purchaseDay: "2026-11-02",
      }),
    );

    await assert.rejects(tx(db.pool, (c) => updatePriceOption(c, admin, optId, { ...raten, label: "Neu" })), /schon verkauft/);
    await assert.rejects(db.pool.query(`update app.price_options set amount_cents = 1 where id = $1`, [optId]), /verkauft/);
    // Unveränderte Angaben speichern ist kein Fehler.
    await tx(db.pool, (c) => updatePriceOption(c, admin, optId, raten));

    // Letzte aktive Option eines freigeschalteten Produkts bleibt an.
    await assert.rejects(tx(db.pool, (c) => setPriceOptionActive(c, admin, optId, false)), /letzte aktive/);
    await tx(db.pool, (c) => setProductActive(c, admin, id, false));
    await tx(db.pool, (c) => setPriceOptionActive(c, admin, optId, false));

    const list = await listProducts(db.pool, admin, { search: "verkauft" });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.orders, 1);
    assert.equal(list[0]!.activeOptions, 0);
    assert.equal((await getProduct(db.pool, admin, id))!.options[0]!.sold, 1);
  });

  it("übernimmt für neue Produkte die Kurszuordnung einer Vorlage aus Thrivecart", async () => {
    const companyId = (await db.pool.query(`select id from app.companies limit 1`)).rows[0].id as string;
    const vorlage = (
      await db.pool.query(
        `insert into app.products (company_id, name, tax_category, thrivecart_product_id) values ($1, 'Alter Kurs', 'standard', 4711) returning id`,
        [companyId],
      )
    ).rows[0].id as string;
    const ohne = await tx(db.pool, (c) => createProduct(c, admin, null, { ...product, name: "Ohne Nummer", slug: "ohne-nummer" }));
    const neu = await tx(db.pool, (c) => createProduct(c, admin, null, { ...product, name: "Neuer Kurs", slug: "neuer-kurs" }));

    await assert.rejects(tx(db.pool, (c) => setAccessLike(c, admin, neu, ohne)), /Vorlage geht nur ein Produkt aus Thrivecart/);
    await assert.rejects(tx(db.pool, (c) => setAccessLike(c, admin, vorlage, vorlage)), /eigene Zuordnung/);
    await assert.rejects(tx(db.pool, (c) => setAccessLike(c, pruefer, neu, vorlage)), /Berechtigung/);
    await tx(db.pool, (c) => setAccessLike(c, admin, neu, vorlage));
    const p = (await getProduct(db.pool, admin, neu))!;
    assert.deepEqual([p.accessLikeProductId, p.accessLikeName], [vorlage, "Alter Kurs"]);

    // Die Meldung an n8n trägt die Thrivecart-Nummer der Vorlage.
    await tx(db.pool, (c) => createPriceOption(c, admin, neu, einmal));
    await confirm(neu);
    await tx(db.pool, (c) => setProductActive(c, admin, neu, true));
    const optionId = (await getProduct(db.pool, admin, neu))!.options[0]!.id;
    const placed = await tx(db.pool, (c) =>
      placeOrder(c, {
        priceOptionId: optionId,
        customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
        vatIdVerified: false,
        sellerUserId: null,
        agbVersionId: legal[0]!,
        privacyVersionId: legal[1]!,
        withdrawalVersionId: legal[2]!,
        withdrawalWaiver: true,
        purchaseDay: "2026-11-02",
      }),
    );
    await tx(db.pool, (c) => enqueueWebhook(c, "bestellung.beendet", placed.orderId));
    const payload = (await db.pool.query(`select payload from app.webhook_outbox where payload->'order'->>'order_id' = $1`, [placed.orderId])).rows[0].payload;
    assert.equal(payload.order.product.thrivecart_product_id, 4711);
    assert.equal(payload.order.product.access_like_product_id, vorlage);

    // Zuordnung aufheben geht.
    await tx(db.pool, (c) => setAccessLike(c, admin, neu, null));
    assert.equal((await getProduct(db.pool, admin, neu))!.accessLikeProductId, null);
  });

  it("zeigt Prüferinnen alles, Vertrieb nichts", async () => {
    assert.ok((await listProducts(db.pool, pruefer)).length >= 3);
    await assert.rejects(listProducts(db.pool, vertrieb), /Berechtigung/);
    const id = (await listProducts(db.pool, pruefer))[0]!.id;
    await assert.rejects(tx(db.pool, (c) => setProductActive(c, pruefer, id, false)), /Berechtigung/);
    assert.equal(await getProduct(db.pool, admin, "kein-uuid"), null);
  });
});
