import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { graphSender } from "../src/graph-mail.ts";
import { retryDelayMs, sendPendingMails, type OutgoingMail } from "../src/mail-outbox.ts";
import { NoticeError, submitNotice } from "../src/notices.ts";
import { placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Kündigung, Widerruf und Postausgang", () => {
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

  const received = new Date(Date.UTC(2026, 10, 2, 23, 30));

  it("hält eine Kündigung fest, ordnet sie der Bestellung zu und legt die Bestätigung in den Postausgang", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, aboOrder));
    const r = await tx(db.pool, (c) =>
      submitNotice(
        c,
        {
          kind: "kuendigung",
          fullName: " Erika Muster ",
          email: "ERIKA@example.org",
          contractReference: `Bestellung ${placed.orderId}`,
          cancellationType: "ordentlich",
          requestedEnd: null,
        },
        received,
      ),
    );
    assert.equal(r.matched, "bestellung");
    assert.match(r.confirmation.body, /3\. November 2026 um 00:30:00 Uhr/);
    assert.match(r.confirmation.body, /nächstmöglichen Zeitpunkt/);
    const row = (await db.pool.query(`select order_id, customer_id, email, full_name from app.contract_notices where id = $1`, [r.id])).rows[0];
    assert.deepEqual(row, { order_id: placed.orderId, customer_id: placed.customerId, email: "erika@example.org", full_name: "Erika Muster" });
    const mail = (await db.pool.query(`select to_address, purpose, sent_at from app.mail_outbox where id = $1`, [r.mailId])).rows[0];
    assert.deepEqual(mail, { to_address: "erika@example.org", purpose: "kuendigung_bestaetigung", sent_at: null });
  });

  it("speichert auch ohne passenden Vertrag und ordnet nie über eine fremde E-Mail-Adresse zu", async () => {
    const placed = await tx(db.pool, (c) => placeOrder(c, order));
    const r = await tx(db.pool, (c) =>
      submitNotice(c, { kind: "widerruf", fullName: "Max Probe", email: "max@example.org", contractReference: placed.orderId }, received),
    );
    assert.equal(r.matched, null);
    assert.match(r.confirmation.subject, /Widerruf/);
    assert.match(r.confirmation.body, /§ 356a BGB/);
  });

  it("verlangt bei außerordentlicher Kündigung einen Grund", async () => {
    await assert.rejects(
      tx(db.pool, (c) =>
        submitNotice(c, { kind: "kuendigung", fullName: "A", email: "a@example.org", contractReference: "x", cancellationType: "ausserordentlich" }),
      ),
      NoticeError,
    );
    await assert.rejects(tx(db.pool, (c) => submitNotice(c, { kind: "widerruf", fullName: "A", email: "kein-at", contractReference: "x" })), NoticeError);
  });

  it("verschickt fällige E-Mails genau einmal und versucht Fehlschläge später erneut", async () => {
    const sent: OutgoingMail[] = [];
    let fail = true;
    const send = async (m: OutgoingMail) => {
      if (fail) throw new Error("Postfach nicht erreichbar");
      sent.push(m);
      return { messageId: "msg-1" };
    };
    const first = await sendPendingMails(db.pool, send);
    assert.deepEqual(first, { sent: 0, failed: 2 });
    const waiting = (await db.pool.query(`select attempts, last_error, next_attempt_at > now() later from app.mail_outbox`)).rows;
    assert.ok(waiting.every((w) => w.attempts === 1 && w.later && /nicht erreichbar/.test(w.last_error)));

    await db.pool.query(`update app.mail_outbox set next_attempt_at = now()`);
    fail = false;
    assert.deepEqual(await sendPendingMails(db.pool, send), { sent: 2, failed: 0 });
    assert.deepEqual(await sendPendingMails(db.pool, send), { sent: 0, failed: 0 });
    assert.equal(sent.length, 2);
    assert.ok(sent.some((m) => m.to === "erika@example.org" && /Kündigung/.test(m.subject)));
    assert.equal(retryDelayMs(1), 60_000);
    assert.equal(retryDelayMs(20), 3_600_000);
  });

  it("schützt Erklärungen und versendete E-Mails vor Änderungen", async () => {
    await assert.rejects(db.pool.query(`update app.contract_notices set email = 'x@example.org'`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from app.contract_notices`), /GoBD/);
    await assert.rejects(db.pool.query(`update app.mail_outbox set body_text = 'anders'`), /GoBD/);
    await assert.rejects(db.pool.query(`update app.mail_outbox set sent_at = null`), /GoBD/);
    await assert.rejects(db.pool.query(`delete from app.mail_outbox`), /GoBD/);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });

  it("verschickt über Microsoft Graph als hinterlegtes Postfach", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      return new Response(null, { status: 202, headers: { "request-id": "req-9" } });
    }) as unknown as typeof fetch;
    const send = graphSender({ tenantId: "ten", clientId: "c", clientSecret: "s", from: "service@example.org" }, fakeFetch);
    const r = await send({ id: "m1", to: "erika@example.org", subject: "Betreff", body: "Text", attachments: [{ name: "a.pdf", contentType: "application/pdf", content: Buffer.from("%PDF") }] });
    assert.equal(r.messageId, "req-9");
    await send({ id: "m2", to: "erika@example.org", subject: "Betreff", body: "Text", attachments: [] });
    assert.equal(calls.filter((c) => c.url.includes("login")).length, 1);
    const mail = calls.find((c) => c.url.includes("/users/service%40example.org/sendMail"))!;
    const msg = JSON.parse(mail.body).message;
    assert.equal(msg.toRecipients[0].emailAddress.address, "erika@example.org");
    assert.equal(msg.attachments[0].contentBytes, Buffer.from("%PDF").toString("base64"));
    // Gestaltete HTML-Fassung mit eingebettetem Logo.
    assert.equal(msg.body.contentType, "HTML");
    assert.match(msg.body.content, /<p[^>]*>Text<\/p>/);
    assert.deepEqual([msg.attachments[1].isInline, msg.attachments[1].contentId, msg.attachments.length], [true, "idf-logo", 2]);
  });
});
