import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SessionUser } from "../src/auth.ts";
import { dueCharges } from "../src/billing.ts";
import { recordInstallmentPayment, PaymentError } from "../src/invoicing.ts";
import {
  cancelManualOrder,
  countManualOrders,
  createManualOrder,
  listManualOrders,
  ManualOrderError,
  manualOrderDetail,
  recordManualPayment,
  recordManualRefund,
  type ManualOrderInput,
} from "../src/manual-orders.ts";
import { cardSetupTarget, nextPaymentTarget } from "../src/stripe.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Manuelle Bestellungen (Rechnung vorab, Überweisung)", () => {
  let db: TestDb;
  let admin: SessionUser;
  let sales: SessionUser;
  let otherSales: SessionUser;
  let product: string;
  let exempt: string;
  let unconfirmed: string;

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city, iban, bank_name)
       values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin', 'DE02120300000000202051', 'Testbank') returning id`,
    );
    await db.pool.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, 'T-', 1)`, [companyId]);
    const user = async (email: string, role: string) =>
      ({ id: await q(`insert into app.users (email, display_name, role) values ($1, $1, $2) returning id`, [email, role]), email, displayName: email, role, salesCode: null }) as SessionUser;
    admin = await user("admin@example.org", "admin");
    sales = await user("sales@example.org", "vertrieb");
    otherSales = await user("sales2@example.org", "vertrieb");
    const prod = (name: string, cat: string, confirmed: boolean) =>
      q(
        `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
         values ($1, $2, $3, false, case when $4 then now() end, case when $4 then $5::uuid end) returning id`,
        [companyId, name, cat, confirmed, admin.id],
      );
    product = await prod("Masterclass", "standard", true);
    exempt = await prod("Coaching", "steuerfrei_4_21", true);
    unconfirmed = await prod("Neu", "standard", false);
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      await db.pool.query(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', $2, now())`, [kind, `Text ${kind}`]);
    }
  });
  after(() => db.drop());

  let n = 0;
  const input = (o: Partial<ManualOrderInput> = {}): ManualOrderInput => ({
    productId: product,
    customer: { kind: "privat", first_name: "Erika", last_name: "Muster", email: `erika${++n}@example.org`, street: "Weg 1", postal_code: "12345", city: "Musterstadt", country: "DE" },
    vatIdVerified: false,
    sellerUserId: null,
    plan: { model: "einmal", totalCents: 119000, paymentTermDays: 14 },
    issueDay: "2026-11-01",
    alreadyPaid: null,
    sendMail: true,
    internalNote: null,
    ...o,
  });
  const create = (o: Partial<ManualOrderInput> = {}, who = admin) => tx(db.pool, (c) => createManualOrder(c, who, input(o)));
  const one = async (sql: string, params: unknown[]) => (await db.pool.query(sql, params)).rows[0];

  it("stellt die Rechnung über den Gesamtbetrag sofort aus, mit Bankverbindung, PDF und Mail", async () => {
    const r = await create();
    assert.equal(r.invoiceNumber, "T-1");
    const inv = await one(`select * from app.invoices where id = $1`, [r.invoiceId]);
    assert.equal(inv.kind, "rechnung");
    assert.equal(Number(inv.gross_cents), 119000);
    assert.equal(Number(inv.net_cents), 100000);
    assert.match(inv.note, /Zahlbar per Überweisung bis zum 15\.11\.2026/);
    assert.match(inv.note, /IBAN DE02 1203 0000 0000 2020 51/);
    assert.match(inv.note, /Verwendungszweck: T-1/);
    assert.ok(inv.pdf_sha256);
    const order = await one(`select status, total_gross_cents from app.orders where id = $1`, [r.orderId]);
    assert.equal(order.status, "offen");
    const inst = await one(`select due_date::text, status, invoice_id from app.order_installments where order_id = $1`, [r.orderId]);
    assert.equal(inst.due_date, "2026-11-15");
    assert.equal(inst.invoice_id, null);
    const mail = await one(`select purpose, related_id, body_text, to_address from app.mail_outbox where related_id = $1`, [r.invoiceId]);
    assert.equal(mail.purpose, "rechnung");
    assert.match(mail.body_text, /bis zum 15\.11\.2026/);
    assert.match(mail.body_text, /Verwendungszweck: T-1/);
    assert.match(mail.body_text, /Text widerruf/);
    assert.match(mail.body_text, /Text agb/);
    const opt = await one(
      `select o.active, o.manual_only from app.order_items it join app.price_options o on o.id = it.price_option_id where it.order_id = $1`,
      [r.orderId],
    );
    assert.deepEqual(opt, { active: false, manual_only: true });
    // Die verdeckte Preisoption lässt sich nicht einschalten.
    await assert.rejects(db.pool.query(`update app.price_options set active = true where product_id = $1 and manual_only`, [product]));
  });

  it("Ratenplan mit Steuerbefreiung: Fälligkeiten, Plan auf der Rechnung, keine Steuer", async () => {
    const r = await create({
      productId: exempt,
      plan: { model: "raten", totalCents: 300000, firstCents: 100000, installmentCount: 3, nextDueDate: "2026-12-01", paymentTermDays: 7 },
    });
    const rows = (await db.pool.query(`select seq, due_date::text, gross_cents, tax_cents from app.order_installments where order_id = $1 order by seq`, [r.orderId])).rows;
    assert.deepEqual(
      rows.map((x) => [x.seq, x.due_date, Number(x.gross_cents), Number(x.tax_cents)]),
      [
        [1, "2026-11-08", 100000, 0],
        [2, "2026-12-01", 100000, 0],
        [3, "2027-01-01", 100000, 0],
      ],
    );
    const inv = await one(`select note, tax_cents from app.invoices where id = $1`, [r.invoiceId]);
    assert.equal(Number(inv.tax_cents), 0);
    assert.match(inv.note, /Rate 2 von 3: 1\.000,00 €, fällig am 01\.12\.2026/);
    const item = await one(`select tax_exemption_note from app.invoice_items where invoice_id = $1`, [r.invoiceId]);
    assert.match(item.tax_exemption_note, /§ 4 Nr\. 21/);
  });

  it("nie per Karte, PayPal oder automatischem Einzug", async () => {
    const r = await create({ plan: { model: "anzahlung_rest", totalCents: 200000, firstCents: 50000, nextDueDate: "2026-12-20", paymentTermDays: 0 } });
    assert.equal(await nextPaymentTarget(db.pool, r.orderId, "2099-12-31"), null);
    assert.equal(await cardSetupTarget(db.pool, r.orderId), null);
    assert.equal((await dueCharges(db.pool, "2099-12-31")).filter((d) => d.orderId === r.orderId).length, 0);
    const inst = await one(`select id from app.order_installments where order_id = $1 and seq = 1`, [r.orderId]);
    await assert.rejects(
      tx(db.pool, (c) => recordInstallmentPayment(c, { installmentId: inst.id, provider: "stripe", providerRef: "pi_x", paidAt: new Date(), issueDay: "2026-11-02" })),
      PaymentError,
    );
  });

  it("verbucht Zahlungen von Hand ohne neue Rechnung und meldet sie an n8n", async () => {
    const r = await create({ plan: { model: "anzahlung_rest", totalCents: 200000, firstCents: 50000, nextDueDate: "2026-12-20", paymentTermDays: 14 } });
    const insts = (await db.pool.query(`select id from app.order_installments where order_id = $1 order by seq`, [r.orderId])).rows;
    const invoicesBefore = Number((await one(`select count(*) n from app.invoices`, [])).n);
    await tx(db.pool, (c) => recordManualPayment(c, admin, r.orderId, insts[0].id, "2026-11-01", "Buchung 4711"));
    assert.equal((await one(`select status from app.orders where id = $1`, [r.orderId])).status, "teilbezahlt");
    await assert.rejects(tx(db.pool, (c) => recordManualPayment(c, admin, r.orderId, insts[0].id, "2026-11-01", "")), ManualOrderError);
    await assert.rejects(tx(db.pool, (c) => recordManualPayment(c, sales, r.orderId, insts[1].id, "2026-11-01", "")), ManualOrderError);
    await tx(db.pool, (c) => recordManualPayment(c, admin, r.orderId, insts[1].id, "2026-11-01", ""));
    assert.equal((await one(`select status from app.orders where id = $1`, [r.orderId])).status, "bezahlt");
    assert.equal(Number((await one(`select count(*) n from app.invoices`, [])).n), invoicesBefore);
    const hooks = (await db.pool.query(`select payload from app.webhook_outbox where event_type = 'zahlung.eingegangen' and payload->'order'->>'order_id' = $1 order by created_at`, [r.orderId])).rows;
    assert.equal(hooks.length, 2);
    assert.equal(hooks[0].payload.payment.first, true);
    assert.equal(hooks[0].payload.payment.invoice_number, r.invoiceNumber);
    assert.equal(hooks[0].payload.payment.provider, "ueberweisung");
    const pay = await one(`select provider, provider_ref, (paid_at at time zone 'Europe/Berlin')::date::text paid_day from app.payments where order_id = $1 order by provider_ref limit 1`, [r.orderId]);
    assert.deepEqual(pay, { provider: "ueberweisung", provider_ref: `${r.invoiceNumber}/1`, paid_day: "2026-11-01" });
  });

  it("Storno ohne Zahlung: volle Stornorechnung, nichts zurückzuzahlen, keine Meldung an n8n", async () => {
    const r = await create();
    const s = await tx(db.pool, (c) => cancelManualOrder(c, admin, r.orderId, "Kundin hat nicht bezahlt", true));
    assert.equal(s.refundDueCents, 0);
    const st = await one(`select kind, corrects_invoice_id, gross_cents, note, pdf_sha256 is not null pdf from app.invoices where invoice_number = $1`, [s.stornoNumber]);
    assert.equal(st.kind, "storno");
    assert.equal(st.corrects_invoice_id, r.invoiceId);
    assert.equal(Number(st.gross_cents), -119000);
    assert.match(st.note, /keine Zahlung eingegangen/);
    assert.doesNotMatch(st.note, /nicht bezahlt/);
    assert.ok(st.pdf);
    assert.equal((await one(`select status from app.orders where id = $1`, [r.orderId])).status, "storniert");
    assert.equal((await one(`select status from app.order_installments where order_id = $1`, [r.orderId])).status, "storniert");
    const mail = await one(`select subject, body_text from app.mail_outbox where subject like '%Stornorechnung%' and body_text like $1`, [`%${r.invoiceNumber}%`]);
    assert.match(mail.body_text, /Du musst nichts mehr bezahlen/);
    assert.equal(Number((await one(`select count(*) n from app.webhook_outbox where payload->'order'->>'order_id' = $1`, [r.orderId])).n), 0);
    await assert.rejects(tx(db.pool, (c) => cancelManualOrder(c, admin, r.orderId, "nochmal", false)), ManualOrderError);
    await assert.rejects(tx(db.pool, (c) => recordManualRefund(c, admin, r.orderId, "2026-11-02", "")), ManualOrderError);
    const detail = await manualOrderDetail(db.pool, admin, r.orderId, "2026-11-02");
    assert.equal(detail!.head.status, "storniert");
  });

  it("Storno nach Teilzahlung: Rückzahlung offen, dann verbucht; alles festgeschrieben", async () => {
    const r = await create({ plan: { model: "anzahlung_rest", totalCents: 200000, firstCents: 50000, nextDueDate: "2026-12-20", paymentTermDays: 14 } });
    const first = (await one(`select id from app.order_installments where order_id = $1 and seq = 1`, [r.orderId])).id;
    await tx(db.pool, (c) => recordManualPayment(c, admin, r.orderId, first, "2026-11-01", ""));
    await assert.rejects(tx(db.pool, (c) => cancelManualOrder(c, sales, r.orderId, "Widerruf", true)), ManualOrderError);
    await assert.rejects(tx(db.pool, (c) => cancelManualOrder(c, admin, r.orderId, "  ", true)), ManualOrderError);
    const s = await tx(db.pool, (c) => cancelManualOrder(c, admin, r.orderId, "Widerruf vom 02.11.", true));
    assert.equal(s.refundDueCents, 50000);
    const st = await one(`select gross_cents, note from app.invoices where invoice_number = $1`, [s.stornoNumber]);
    assert.equal(Number(st.gross_cents), -200000);
    assert.match(st.note, /Bereits gezahlte 500,00 € werden per Überweisung zurückgezahlt/);
    const [row] = await listManualOrders(db.pool, admin, { today: "2026-11-02", status: "rueckzahlung_offen", search: r.invoiceNumber });
    assert.equal(row?.status, "rueckzahlung_offen");
    assert.equal(row?.paidCents, 50000);
    const ended = await one(`select count(*) n from app.webhook_outbox where event_type = 'bestellung.beendet' and payload->'order'->>'order_id' = $1`, [r.orderId]);
    assert.equal(Number(ended.n), 1);

    await tx(db.pool, (c) => recordManualRefund(c, admin, r.orderId, "2026-11-03", "Rücküberweisung"));
    assert.equal((await one(`select status from app.orders where id = $1`, [r.orderId])).status, "erstattet");
    const back = await one(`select amount_cents, status from app.payments where order_id = $1 and status = 'erstattet'`, [r.orderId]);
    assert.equal(Number(back.amount_cents), -50000);
    await assert.rejects(tx(db.pool, (c) => recordManualRefund(c, admin, r.orderId, "2026-11-03", "")), ManualOrderError);
    const hook = await one(`select payload from app.webhook_outbox where event_type = 'zahlung.erstattet' and payload->'order'->>'order_id' = $1`, [r.orderId]);
    assert.equal(hook.payload.refund.gross_cents, 50000);

    // GoBD: nichts lässt sich nachträglich ändern oder löschen.
    await assert.rejects(db.pool.query(`update app.manual_orders set cancel_reason = 'anders' where order_id = $1`, [r.orderId]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`update app.manual_orders set refund_reference = 'anders' where order_id = $1`, [r.orderId]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`update app.manual_orders set pay_by = '2030-01-01' where order_id = $1`, [r.orderId]), /festgeschrieben/);
    await assert.rejects(db.pool.query(`delete from app.manual_orders where order_id = $1`, [r.orderId]), /GoBD/);
    await assert.rejects(db.pool.query(`update app.manual_order_events set detail = 'x' where order_id = $1`, [r.orderId]), /GoBD/);
    const events = (await db.pool.query(`select kind from app.manual_order_events where order_id = $1 order by created_at`, [r.orderId])).rows.map((e) => e.kind);
    assert.deepEqual(events, ["angelegt", "zahlung", "storno", "rueckzahlung"]);
  });

  it("schon bezahlt beim Anlegen: Rechnung und Mail sagen bezahlt", async () => {
    const r = await create({ alreadyPaid: { paidOn: "2026-10-30", reference: "" } });
    assert.equal((await one(`select status from app.orders where id = $1`, [r.orderId])).status, "bezahlt");
    const inv = await one(`select note from app.invoices where id = $1`, [r.invoiceId]);
    assert.match(inv.note, /am 30\.10\.2026 per Überweisung bezahlt/);
    assert.doesNotMatch(inv.note, /IBAN/);
    const mail = await one(`select body_text from app.mail_outbox where related_id = $1`, [r.invoiceId]);
    assert.match(mail.body_text, /bereits bezahlt/);
    await assert.rejects(create({ alreadyPaid: { paidOn: "2026-11-05", reference: "" } }), ManualOrderError);
  });

  it("Vertrieb legt nur für sich selbst an und sieht nur die eigenen", async () => {
    const r = await create({ sellerUserId: otherSales.id }, sales);
    assert.equal((await one(`select seller_user_id from app.orders where id = $1`, [r.orderId])).seller_user_id, sales.id);
    await assert.rejects(create({ alreadyPaid: { paidOn: "2026-11-01", reference: "" } }, sales), ManualOrderError);
    const mine = await listManualOrders(db.pool, sales, { today: "2026-11-01", status: "alle" });
    assert.deepEqual(mine.map((x) => x.orderId), [r.orderId]);
    assert.equal((await listManualOrders(db.pool, otherSales, { today: "2026-11-01", status: "alle" })).length, 0);
    assert.equal(await manualOrderDetail(db.pool, otherSales, r.orderId, "2026-11-01"), null);
    const pruefer = { ...sales, role: "pruefer" as const };
    await assert.rejects(create({}, pruefer), ManualOrderError);
  });

  it("überfällig nach dem Zahlungsziel; ohne bestätigte Steuer oder Bankverbindung keine Rechnung", async () => {
    const r = await create();
    const before = await listManualOrders(db.pool, admin, { today: "2026-11-15", status: "alle", search: r.invoiceNumber });
    assert.equal(before[0]?.status, "offen");
    const after = await listManualOrders(db.pool, admin, { today: "2026-11-16", status: "ueberfaellig", search: r.invoiceNumber });
    assert.equal(after[0]?.status, "ueberfaellig");
    const counts = await countManualOrders(db.pool, admin, "2026-11-16");
    assert.ok(counts.ueberfaellig >= 1);

    await assert.rejects(create({ productId: unconfirmed }), /Steuer/);
    const seq = (await one(`select next_value from app.invoice_number_series`, [])).next_value;
    await db.pool.query(`update app.companies set iban = null`);
    await assert.rejects(create(), /Bankverbindung/);
    await db.pool.query(`update app.companies set iban = 'DE02120300000000202051'`);
    // Abgelehnte Versuche verbrauchen keine Rechnungsnummer.
    assert.equal((await one(`select next_value from app.invoice_number_series`, [])).next_value, seq);
  });
});
