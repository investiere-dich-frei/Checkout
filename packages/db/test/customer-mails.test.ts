import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { enqueueOrderConfirmation } from "../src/customer-mails.ts";
import { invoicePdf, renderInvoicePdf } from "../src/invoice-pdf.ts";
import { sendPendingMails, type OutgoingMail } from "../src/mail-outbox.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { handleStripeEvent, nextPaymentTarget, rememberPaymentIntent } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("E-Mails an Kundinnen", () => {
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
        await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Wortlaut ' || $1, now()) returning id`, [kind]),
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

  it("bestätigt die Bestellung mit Zahlplan, Rechtstexten im Wortlaut und dem erklärten Sofortstart", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const mailId = await tx(db.pool, (c) => enqueueOrderConfirmation(c, placed.orderId, "https://kasse.example.org/bestellung/x"));
    const m = (await db.pool.query(`select purpose, to_address, subject, body_text, related_id from app.mail_outbox where id = $1`, [mailId])).rows[0];
    assert.equal(m.purpose, "bestellbestaetigung");
    assert.equal(m.to_address, "erika@example.org");
    assert.equal(m.related_id, placed.orderId);
    assert.match(m.subject, /Coaching/);
    assert.match(m.body_text, /Hallo Erika Muster,/);
    assert.match(m.body_text, /02\.11\.2026: 500,00\s€/);
    assert.match(m.body_text, /02\.12\.2026: 500,00\s€/);
    assert.match(m.body_text, /§ 4 Nr\. 21/);
    assert.match(m.body_text, /Wortlaut widerruf/);
    assert.match(m.body_text, /Wortlaut agb/);
    assert.match(m.body_text, /Ich verlange ausdrücklich, dass die Investiere Dich Frei GmbH vor Ablauf der Widerrufsfrist/);
    assert.match(m.body_text, /kasse\.example\.org/);
  });

  it("nennt ohne Sofortstart den Starttermin nach Ablauf der Widerrufsfrist", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, { ...order, withdrawalWaiver: false }));
    const mailId = await tx(db.pool, (c) => enqueueOrderConfirmation(c, placed.orderId, "https://kasse.example.org/bestellung/y"));
    const m = (await db.pool.query(`select body_text from app.mail_outbox where id = $1`, [mailId])).rows[0];
    const start = (await db.pool.query(`select to_char((created_at at time zone 'Europe/Berlin')::date + 15, 'DD.MM.YYYY') d from app.orders where id = $1`, [placed.orderId])).rows[0].d;
    assert.match(m.body_text, new RegExp(`Zugang bekommst du am ${start.replace(/\./g, "\\.")}`));
    assert.doesNotMatch(m.body_text, /Ich verlange ausdrücklich/);
  });

  it("schickt die Rechnung genau einmal, wenn die Zahlung gebucht wird", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const t = (await nextPaymentTarget(db.pool, placed.orderId, "2099-12-31"))!;
    await rememberPaymentIntent(db.pool, { id: "pi_mail", installmentId: t.installmentId, amountCents: t.grossCents, currency: "eur" });
    const ev = (id: string) => ({
      id,
      type: "payment_intent.succeeded",
      created: Date.UTC(2026, 0, 31, 12) / 1000,
      payload: {},
      paymentIntent: { id: "pi_mail", status: "succeeded", amountReceived: t.grossCents, currency: "eur", metadata: {} },
    });
    const r = await tx(db.pool, (c) => handleStripeEvent(c, ev("evt_m1")));
    await tx(db.pool, (c) => handleStripeEvent(c, ev("evt_m2")));
    const mails = (await db.pool.query(`select subject, body_text from app.mail_outbox where purpose = 'rechnung'`)).rows;
    assert.equal(mails.length, 1);
    assert.equal(mails[0].subject, `Deine Rechnung ${r.invoiceNumber}`);
    assert.match(mails[0].body_text, /vom 31\.01\.2026/);
    assert.match(mails[0].body_text, /Test GmbH/);

    // Das PDF liegt unveränderbar ab, die Rechnung verweist mit Hash darauf.
    const inv = (await db.pool.query(`select id, encode(pdf_sha256, 'hex') h, pdf_storage_key k from app.invoices where invoice_number = $1`, [r.invoiceNumber])).rows[0];
    const doc = (await db.pool.query(`select id, encode(sha256(pdf), 'hex') h from app.invoice_documents where invoice_id = $1`, [inv.id])).rows[0];
    assert.equal(inv.h, doc.h);
    assert.equal(inv.k, `db:${doc.id}`);
    await assert.rejects(db.pool.query(`update app.invoice_documents set pdf = '\\x00'`), /GoBD/);
    await assert.rejects(db.pool.query(`update app.invoices set pdf_storage_key = 'x' where id = $1`, [inv.id]), /GoBD/);

    // Die Rechnungsmail trägt genau dieses PDF als Anhang.
    const out: OutgoingMail[] = [];
    await sendPendingMails(db.pool, async (m) => (out.push(m), { messageId: null }));
    const withPdf = out.find((m) => m.subject.startsWith("Deine Rechnung"))!;
    const stored = (await invoicePdf(db.pool, inv.id))!;
    assert.equal(withPdf.attachments[0]!.name, `Rechnung-${r.invoiceNumber}.pdf`);
    assert.ok(withPdf.attachments[0]!.content.equals(stored.pdf));
    assert.equal(stored.pdf.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });

  it("erzeugt für dieselbe Rechnung immer dasselbe PDF", async () => {
    const data = {
      invoiceNumber: "IDF-1",
      kind: "rechnung" as const,
      correctsNumber: null,
      issueDate: "2026-11-03",
      serviceFrom: "2026-11-03",
      serviceTo: "2026-12-02",
      currency: "EUR",
      netCents: 10000,
      taxCents: 1900,
      grossCents: 11900,
      note: null,
      company: { legal_name: "Test GmbH", street: "Teststr. 1", postal_code: "10115", city: "Berlin", country: "DE", vat_id: "DE000000000", tax_number: null, register_info: "Amtsgericht Musterstadt HRB 1" },
      customer: { kind: "privat", first_name: "Erika", last_name: "Muster", company_name: null, street: "Weg 1", postal_code: "12345", city: "Ort", country: "DE", vat_id: null, email: "erika@example.org" },
      items: [{ position: 1, description: "Coaching – Monatlich", quantity: 1, unitNetCents: 10000, netCents: 10000, taxRateBp: 1900, taxCents: 1900, grossCents: 11900, note: null }],
      paid: true,
    };
    const a = Buffer.from(await renderInvoicePdf(data));
    const b = Buffer.from(await renderInvoicePdf(data));
    assert.ok(a.equals(b));
  });
});
