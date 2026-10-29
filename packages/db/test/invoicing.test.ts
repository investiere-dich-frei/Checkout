import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PaymentError, recordInstallmentPayment } from "../src/invoicing.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Zahlungseingang und Rechnung", () => {
  let db: TestDb;
  let order: PlaceOrderInput;
  let aboOrder: PlaceOrderInput;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const product = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
       values ($1, 'Coaching', 'steuerfrei_4_21', true, now(), $2) returning id`,
      [companyId, admin],
    );
    const raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '2 Raten', 'raten', 50000, 'netto', 50000, 1, 2, 1) returning id`,
      [product],
    );
    const abo = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, interval_months)
       values ($1, 'Monatlich', 'abo', 9900, 'netto', 9900, 1) returning id`,
      [product],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(
        await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]),
      );
    }
    order = {
      priceOptionId: raten,
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: "erika@example.org", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: "2026-11-02",
    };
    aboOrder = { ...order, priceOptionId: abo, purchaseDay: "2026-01-31" };
  });
  after(() => db.drop());

  const installments = async (orderId: string) =>
    (await db.pool.query(`select id, seq, status from app.order_installments where order_id = $1 order by seq`, [orderId])).rows;

  it("stellt je Zahlung eine Rechnung aus und führt den Bestellstatus fort", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const [first, second] = await installments(placed.orderId);

    const r1 = await tx(db.pool, (c) =>
      recordInstallmentPayment(c, { installmentId: first.id, provider: "stripe", providerRef: "pi_1", paidAt: new Date(), issueDay: "2026-11-02" }),
    );
    assert.equal(r1.invoiceNumber, "T-1");
    assert.equal((await db.pool.query(`select status from app.orders where id = $1`, [placed.orderId])).rows[0].status, "teilbezahlt");

    const item = (await db.pool.query(`select description, tax_rate_bp, tax_exemption_note, gross_cents from app.invoice_items where invoice_id = $1`, [r1.invoiceId])).rows[0];
    assert.equal(item.description, "Coaching – 2 Raten (Zahlung 1 von 2)");
    assert.equal(item.tax_rate_bp, 0);
    assert.match(item.tax_exemption_note, /§ 4 Nr. 21/);
    assert.equal(item.gross_cents, "50000");

    const r2 = await tx(db.pool, (c) =>
      recordInstallmentPayment(c, { installmentId: second.id, provider: "stripe", providerRef: "pi_2", paidAt: new Date(), issueDay: "2026-12-02" }),
    );
    assert.equal(r2.invoiceNumber, "T-2");
    assert.equal((await db.pool.query(`select status from app.orders where id = $1`, [placed.orderId])).rows[0].status, "bezahlt");
  });

  it("verbucht dieselbe Zahlungsmeldung nur einmal", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const [first] = await installments(placed.orderId);
    const input = { installmentId: first.id, provider: "stripe" as const, providerRef: "pi_dup", paidAt: new Date(), issueDay: "2026-11-02" };
    const a = await tx(db.pool, (c) => recordInstallmentPayment(c, input));
    const b = await tx(db.pool, (c) => recordInstallmentPayment(c, input));
    assert.equal(b.created, false);
    assert.equal(b.invoiceId, a.invoiceId);
    const count = (await db.pool.query(`select count(*)::int n from app.invoices where order_id = $1`, [placed.orderId])).rows[0].n;
    assert.equal(count, 1);
  });

  it("weist eine Zahlung ab, die schon einer anderen Fälligkeit gehört", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const [first, second] = await installments(placed.orderId);
    await tx(db.pool, (c) =>
      recordInstallmentPayment(c, { installmentId: first.id, provider: "paypal", providerRef: "pp_1", paidAt: new Date(), issueDay: "2026-11-02" }),
    );
    await assert.rejects(
      tx(db.pool, (c) =>
        recordInstallmentPayment(c, { installmentId: second.id, provider: "paypal", providerRef: "pp_1", paidAt: new Date(), issueDay: "2026-11-02" }),
      ),
      PaymentError,
    );
  });

  it("lässt bei einem Fehler keine halbe Buchung und keine Nummernlücke zurück", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const [first] = await installments(placed.orderId);
    const before = (await db.pool.query(`select next_value from app.invoice_number_series`)).rows[0].next_value;
    await assert.rejects(
      tx(db.pool, async (c) => {
        await recordInstallmentPayment(c, { installmentId: first.id, provider: "stripe", providerRef: "pi_abort", paidAt: new Date(), issueDay: "2026-11-02" });
        throw new Error("Abbruch nach der Buchung");
      }),
      /Abbruch/,
    );
    assert.equal((await db.pool.query(`select next_value from app.invoice_number_series`)).rows[0].next_value, before);
    assert.equal((await db.pool.query(`select count(*)::int n from app.payments where provider_ref = 'pi_abort'`)).rows[0].n, 0);
    assert.deepEqual((await installments(placed.orderId)).map((i) => i.status), ["offen", "offen"]);
  });

  it("Abo: Leistungszeitraum ist das bezahlte Intervall", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const [first] = await installments(placed.orderId);
    const r = await tx(db.pool, (c) =>
      recordInstallmentPayment(c, { installmentId: first.id, provider: "stripe", providerRef: "pi_abo", paidAt: new Date(), issueDay: "2026-01-31" }),
    );
    const inv = (await db.pool.query(`select service_date_from::text f, service_date_to::text t from app.invoices where id = $1`, [r.invoiceId])).rows[0];
    assert.deepEqual(inv, { f: "2026-01-31", t: "2026-02-27" });
  });

  it("hält Audit-Kette und Rechnungsregeln ein", async () => {
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
    const nums = (await db.pool.query(`select number_seq::int n from app.invoices order by number_seq`)).rows.map((r) => r.n);
    assert.deepEqual(nums, nums.map((_, i) => i + 1));
  });
});
