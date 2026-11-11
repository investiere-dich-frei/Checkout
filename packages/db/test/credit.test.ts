import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { CreditAnswers } from "@idf/core/credit";
import {
  CreditError,
  decideCreditCheck,
  getCreditSettings,
  optionCredit,
  parseCreditAnswers,
  redactExpiredCreditChecks,
  startCreditCheck,
  updateCreditSettings,
  usableCheck,
  type CheckCustomer,
} from "../src/credit.ts";
import { enqueueWebhook } from "../src/webhooks.ts";
import { CreditRequired, placeOrder, type PlaceOrderInput } from "../src/orders.ts";
import { sendPendingMails } from "../src/mail-outbox.ts";
import { createTestDb, greenCreditCheck, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft, Produkte und Kundinnen, keine echten Daten.
describe("Ratenkauf mit Kredit", () => {
  let db: TestDb;
  let base: Omit<PlaceOrderInput, "priceOptionId" | "customer">;
  const o: Record<string, string> = {};
  const day = "2026-11-25";
  const url = "https://kasse.example.org/kaufen/kurs/x";

  const who = (email: string): CheckCustomer => ({
    first_name: "Erika",
    last_name: "Muster",
    email,
    street: "Teststr. 2",
    postal_code: "10115",
    city: "Berlin",
    country: "DE",
  });
  const good: CreditAnswers = { employment: "angestellt", netIncomeCents: 350_000, housingCents: 90_000, otherCreditsCents: 0, dependents: 0, paymentProblems: false };

  before(async () => {
    db = await createTestDb();
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0].id as string;
    const companyId = await q(
      `insert into app.companies (legal_name, street, postal_code, city) values ('Test GmbH', 'Teststr. 1', '10115', 'Berlin') returning id`,
    );
    const admin = await q(`insert into app.users (email, display_name, role) values ('a@example.org', 'Admin', 'admin') returning id`);
    const kurs = await q(
      `insert into app.products (company_id, name, tax_category, active, tax_confirmed_at, tax_confirmed_by)
       values ($1, 'Kurs', 'steuerfrei_4_21', true, now(), $2) returning id`,
      [companyId, admin],
    );
    o.einmal = await q(`insert into app.price_options (product_id, label, kind, amount_cents, amount_basis) values ($1, 'Einmal', 'einmal', 120000, 'brutto') returning id`, [kurs]);
    o.raten = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '12 Raten', 'raten', 10000, 'brutto', 10000, 11, 12, 1) returning id`,
      [kurs],
    );
    o.kurz = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, interval_months, trial_days)
       values ($1, 'Heute und in 30 Tagen', 'anzahlung', 60000, 'brutto', 60000, 1, 1, 30) returning id`,
      [kurs],
    );
    o.aufschlag = await q(
      `insert into app.price_options (product_id, label, kind, amount_cents, amount_basis, recurring_amount_cents, recurring_count, installments, interval_months)
       values ($1, '12 Raten teurer', 'raten', 11000, 'brutto', 11000, 11, 12, 1) returning id`,
      [kurs],
    );
    const legal: string[] = [];
    for (const kind of ["agb", "datenschutz", "widerruf"]) {
      legal.push(await q(`insert into app.legal_text_versions (kind, version, content, valid_from) values ($1, '1', 'Text', now()) returning id`, [kind]));
    }
    base = {
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal[0]!,
      privacyVersionId: legal[1]!,
      withdrawalVersionId: legal[2]!,
      withdrawalWaiver: true,
      purchaseDay: day,
    };
  });
  after(() => db.drop());

  const mails = async (email: string) =>
    (
      await db.pool.query<{ subject: string; body_text: string; due_in_days: number; purpose: string }>(
        `select subject, body_text, purpose, round(extract(epoch from next_attempt_at - now()) / 86400)::int due_in_days
           from app.mail_outbox where purpose in ('ratenkauf', 'ratenvertrag', 'ratenkauf_erinnerung') and to_address = $1
          order by created_at, next_attempt_at`,
        [email],
      )
    ).rows;

  it("ordnet ein: lange Raten sind Kredit, kurze ohne Aufschlag nicht, vor dem 20.11.2026 altes Recht", async () => {
    const raten = await optionCredit(db.pool, o.raten!, day);
    assert.equal(raten!.isCredit, true);
    assert.equal(raten!.creditCents, 110_000);
    assert.equal(raten!.monthlyRateCents, 10_000);
    assert.equal(raten!.surchargeCents, 0);
    assert.equal((await optionCredit(db.pool, o.kurz!, day))!.isCredit, false);
    assert.equal((await optionCredit(db.pool, o.raten!, "2026-11-19"))!.isCredit, false);
    const teurer = await optionCredit(db.pool, o.aufschlag!, day);
    assert.equal(teurer!.surchargeCents, 12_000);
    assert.equal((await optionCredit(db.pool, o.einmal!, day))!.isCredit, false);
  });

  it("liest den Fragebogen und meldet fehlende Angaben", () => {
    const form: Record<string, string> = {
      credit_employment: "angestellt",
      credit_income: "2.500",
      credit_housing: "800,50",
      credit_other: "",
      credit_dependents: "1",
      credit_problems: "nein",
      credit_confirm: "on",
      credit_adult: "on",
    };
    const r = parseCreditAnswers((k) => form[k] ?? "");
    assert.deepEqual(r, {
      ok: true,
      value: { employment: "angestellt", netIncomeCents: 250_000, housingCents: 80_050, otherCreditsCents: 0, dependents: 1, paymentProblems: false },
    });
    const bad = parseCreditAnswers(() => "");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["adult", "confirmed", "dependents", "employment", "housingCents", "netIncomeCents", "paymentProblems"].filter((k) => k !== "dependents").sort());
  });

  it("verkauft keine Kredit-Raten, solange der Ratenkauf ausgeschaltet ist", async () => {
    await assert.rejects(
      tx(db.pool, (c) => startCreditCheck(c, { priceOptionId: o.raten!, customer: who("aus@example.org"), answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url })),
      CreditError,
    );
    await assert.rejects(tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer: { kind: "privat", ...who("aus@example.org") } })), CreditRequired);
    await db.pool.query(`update app.credit_settings set enabled = true where id`);
  });

  it("grün: Standardinformation vor dem Vertrag, dann Ratenvertrag und Erinnerung an Tag 2", async () => {
    const email = "gruen@example.org";
    const check = await tx(db.pool, (c) =>
      startCreditCheck(c, { priceOptionId: o.raten!, customer: who(email), answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
    );
    assert.equal(check.result, "gruen");
    const before = await mails(email);
    assert.equal(before.length, 1);
    assert.match(before[0]!.body_text, /Europäische Standardinformation für Verbraucherkredite/);
    assert.match(before[0]!.body_text, /Effektiver Jahreszins\n0,00 %/);
    assert.match(before[0]!.body_text, new RegExp(`${url}/raten/${check.checkId}`));
    assert.ok(await usableCheck(db.pool, check.checkId));

    const customer = { kind: "privat" as const, ...who(email) };
    await assert.rejects(tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer })), CreditRequired);
    await assert.rejects(
      tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer, credit: { checkId: check.checkId, agreed: false, valueCompensation: true } })),
      /Ratenzahlungsvertrag/,
    );
    await assert.rejects(
      tx(db.pool, (c) =>
        placeOrder(c, { ...base, priceOptionId: o.raten!, customer: { ...customer, email: "andere@example.org" }, credit: { checkId: check.checkId, agreed: true, valueCompensation: true } }),
      ),
      CreditRequired,
    );
    const placed = await tx(db.pool, (c) =>
      placeOrder(c, {
        ...base,
        priceOptionId: o.raten!,
        customer,
        credit: { checkId: check.checkId, agreed: true, valueCompensation: true, shownInformation: "Angezeigte Fassung" },
      }),
    );
    const order = (await db.pool.query(`select * from app.orders where id = $1`, [placed.orderId])).rows[0];
    assert.equal(order.credit_check_id, check.checkId);
    assert.ok(order.credit_agreement_at);
    assert.ok(order.value_compensation_consent_at);
    // Sofortstart nach § 356 Abs. 5 BGB gibt es beim Kredit nicht, auch wenn das Formular ihn mitschickt.
    assert.equal(order.withdrawal_waiver_at, null);

    const docs = (
      await db.pool.query(`select kind, content, contract_no, order_id from app.credit_documents where credit_check_id = $1 order by created_at, kind`, [
        check.checkId,
      ])
    ).rows;
    assert.deepEqual(docs.map((d) => d.kind), ["standardinformation", "ratenvertrag", "standardinformation_bestellung"]);
    // Beim Bestellen angezeigte Fassung wird im Wortlaut festgeschrieben.
    assert.equal(docs[2]!.content, "Angezeigte Fassung");
    assert.equal(docs[2]!.order_id, placed.orderId);
    assert.match(docs[1]!.contract_no, /^RV-\d+$/);
    assert.match(docs[1]!.content, new RegExp(`Nr\\. ${docs[1]!.contract_no} vom`));
    assert.match(docs[1]!.content, /Barzahlungspreis: 1\.200,00\s€/);
    assert.match(docs[1]!.content, /Widerrufsinformation für den Ratenzahlungsvertrag/);
    assert.match(docs[1]!.content, /Du hast verlangt, sofort Zugang zu bekommen/);

    const after = await mails(email);
    assert.equal(after.length, 3);
    assert.match(after[1]!.subject, /Ratenzahlungsvertrag RV-\d+/);
    assert.match(after[1]!.body_text, /Angezeigte Fassung/);
    assert.equal(after[1]!.purpose, "ratenvertrag");
    assert.equal(after[2]!.purpose, "ratenkauf_erinnerung");
    assert.match(after[2]!.subject, /Erinnerung/);
    assert.equal(after[2]!.due_in_days, 2);
    assert.match(after[2]!.body_text, /bis einschließlich 09\.12\.2026/);

    // Dieselbe Prüfung gilt nur für eine Bestellung.
    assert.equal(await usableCheck(db.pool, check.checkId), null);
    await assert.rejects(
      tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer, credit: { checkId: check.checkId, agreed: true, valueCompensation: false } })),
      CreditRequired,
    );
    // Festgeschrieben.
    await assert.rejects(db.pool.query(`update app.credit_checks set result = 'rot' where id = $1`, [check.checkId]));
    await assert.rejects(db.pool.query(`update app.credit_documents set content = 'x' where credit_check_id = $1`, [check.checkId]));
  });

  it("gelb: erst nach Freigabe durch das Team bestellbar, Entscheidung nur einmal", async () => {
    const email = "gelb@example.org";
    const tight = { ...good, netIncomeCents: 165_000 };
    const check = await tx(db.pool, (c) =>
      startCreditCheck(c, { priceOptionId: o.raten!, customer: who(email), answers: tight, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
    );
    assert.equal(check.result, "gelb");
    assert.equal(await usableCheck(db.pool, check.checkId), null);
    assert.match((await mails(email))[0]!.body_text, /persönlich an/);
    await tx(db.pool, (c) => decideCreditCheck(c, check.checkId, "freigegeben", "Einkommen plausibel", "user:test", url));
    assert.ok(await usableCheck(db.pool, check.checkId));
    assert.match((await mails(email))[1]!.body_text, /Standardinformation/);
    await assert.rejects(tx(db.pool, (c) => decideCreditCheck(c, check.checkId, "abgelehnt", "doch nicht", "user:test", url)), CreditError);
  });

  it("rot: Ablehnung mit Hinweis auf Schuldnerberatung und menschliche Überprüfung", async () => {
    const email = "rot@example.org";
    const check = await tx(db.pool, (c) =>
      startCreditCheck(c, {
        priceOptionId: o.raten!,
        customer: who(email),
        answers: { ...good, paymentProblems: true },
        couponCode: null,
        sellerUserId: null,
        purchaseDay: day,
        offerUrl: url,
      }),
    );
    assert.equal(check.result, "rot");
    const body = (await mails(email))[0]!.body_text;
    assert.match(body, /keine Ratenzahlung/);
    assert.match(body, /Schuldnerberatung/);
    assert.match(body, /prüft ein Mensch/);
  });

  it("wiederholte Anfrage: nach Ablehnung oder mehrfachen Versuchen entscheidet das Team", async () => {
    const start = (email: string, answers: CreditAnswers) =>
      tx(db.pool, (c) => startCreditCheck(c, { priceOptionId: o.raten!, customer: who(email), answers, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }));
    // Erst rot, dann mit geschönten Zahlen: nicht mehr automatisch grün.
    assert.equal((await start("nochmal@example.org", { ...good, netIncomeCents: 100_000 })).result, "rot");
    const again = await start("Nochmal@Example.org", good);
    assert.equal(again.result, "gelb");
    assert.match(again.reasons.join(" "), /schon abgelehnt/);
    // Ohne Ablehnung: erste und zweite Anfrage grün, ab der dritten prüft das Team.
    assert.equal((await start("oft@example.org", good)).result, "gruen");
    assert.equal((await start("oft@example.org", good)).result, "gruen");
    const third = await start("oft@example.org", good);
    assert.equal(third.result, "gelb");
    assert.match(third.reasons.join(" "), /schon 2 Anfragen/);
    // Rot bleibt rot.
    assert.equal((await start("nochmal@example.org", { ...good, paymentProblems: true })).result, "rot");
  });

  it("Länder: Ratenkredit nur bei Anschrift in den eingestellten Ländern (zunächst DE)", async () => {
    const start = (country: string) =>
      tx(db.pool, (c) =>
        startCreditCheck(c, { priceOptionId: o.raten!, customer: { ...who(`land-${country}@example.org`), country }, answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
      );
    await assert.rejects(start("AT"), (e: Error) => e instanceof CreditError && /nur bei einer Anschrift in Deutschland/.test(e.message));
    await assert.rejects(start("CH"), CreditError);
    const s = await getCreditSettings(db.pool);
    await tx(db.pool, (c) => updateCreditSettings(c, { ...s, creditCountries: ["de", "ch"] }, "test"));
    assert.equal((await start("CH")).result, "gruen");
    await assert.rejects(start("AT"), /Deutschland oder der Schweiz/);
    await assert.rejects(tx(db.pool, (c) => updateCreditSettings(c, { ...s, creditCountries: ["Deutschland"] }, "test")), CreditError);
    await tx(db.pool, (c) => updateCreditSettings(c, { ...s, creditCountries: ["DE"] }, "test"));
  });

  it("Sofortzugang-Produkte: bei Ratenkredit ohne Wertersatz-Zustimmung Zugang erst nach der Widerrufsfrist", async () => {
    const email = "sofort@example.org";
    await db.pool.query(`update app.products set immediate_access = true where name = 'Kurs'`);
    try {
      const check = await tx(db.pool, (c) =>
        startCreditCheck(c, { priceOptionId: o.raten!, customer: who(email), answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
      );
      const placed = await tx(db.pool, (c) =>
        placeOrder(c, { ...base, priceOptionId: o.raten!, customer: { kind: "privat", ...who(email) }, credit: { checkId: check.checkId, agreed: true, valueCompensation: false } }),
      );
      await tx(db.pool, (c) => enqueueWebhook(c, "abo.beendet", placed.orderId));
      const payload = (await db.pool.query(`select payload from app.webhook_outbox where payload -> 'order' ->> 'order_id' = $1`, [placed.orderId])).rows[0].payload;
      const d = (await db.pool.query(`select ((created_at at time zone 'Europe/Berlin')::date + 15)::text d from app.orders where id = $1`, [placed.orderId])).rows[0].d;
      assert.equal(payload.order.access_from, d);
      assert.equal(payload.order.sofortstart_at, null);
    } finally {
      await db.pool.query(`update app.products set immediate_access = false where name = 'Kurs'`);
    }
  });

  it("Löschen: Antworten werden nach Ablauf geschwärzt, sonst bleibt die Prüfung festgeschrieben", async () => {
    const email = "loeschen@example.org";
    const fresh = await tx(db.pool, (c) =>
      startCreditCheck(c, { priceOptionId: o.raten!, customer: who(email), answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
    );
    // Eine alte, nie genutzte Prüfung (7 Monate) als Kopie mit früherem Datum.
    const old = (
      await db.pool.query(
        `insert into app.credit_checks (price_option_id, method, rules_version, rules, customer, email, answers, purchase_day, monthly_rate_cents,
           credit_cents, free_income_cents, result, reasons, created_at, expires_at)
         select price_option_id, method, rules_version, rules, customer, email, answers, purchase_day, monthly_rate_cents,
                credit_cents, free_income_cents, result, reasons, now() - interval '7 months', now() - interval '7 months' + interval '7 days'
           from app.credit_checks where id = $1 returning id`,
        [fresh.checkId],
      )
    ).rows[0].id as string;
    // Das Audit-Log enthält die Antworten nicht.
    const audit = (await db.pool.query(`select new_data from app.audit_log where table_name = 'credit_checks' and record_id = $1`, [old])).rows[0].new_data;
    assert.equal(audit.answers, undefined);
    assert.equal(audit.email, undefined);
    assert.equal(audit.result, "gruen");

    // Von Hand ändern oder nur teilweise schwärzen bleibt verboten.
    await assert.rejects(db.pool.query(`update app.credit_checks set answers = '{}'::jsonb where id = $1`, [old]), /GoBD/);
    await assert.rejects(
      db.pool.query(
        `update app.credit_checks set redacted_at = now(), answers = '{}', customer = '{}', email = 'geschwärzt', free_income_cents = null, result = 'rot' where id = $1`,
        [old],
      ),
      /GoBD/,
    );
    await assert.rejects(db.pool.query(`delete from app.credit_checks where id = $1`, [old]), /GoBD/);

    assert.ok((await tx(db.pool, (c) => redactExpiredCreditChecks(c))) >= 1);
    const rows = (await db.pool.query(`select id, answers, customer, email, free_income_cents, result, redacted_at from app.credit_checks where id = any($1)`, [[old, fresh.checkId]])).rows;
    const o1 = rows.find((r) => r.id === old)!;
    assert.deepEqual([o1.answers, o1.customer, o1.email, o1.free_income_cents, o1.result], [{}, {}, "geschwärzt", null, "gruen"]);
    assert.ok(o1.redacted_at);
    const f = rows.find((r) => r.id === fresh.checkId)!;
    assert.equal(f.redacted_at, null);
    assert.equal(f.answers.netIncomeCents, good.netIncomeCents);
    // Einmal geschwärzt, nicht noch einmal und nicht zurück.
    await assert.rejects(db.pool.query(`update app.credit_checks set redacted_at = now() where id = $1`, [old]), /GoBD/);
  });

  it("Aufschlag: keine Prüfung und keine Bestellung", async () => {
    await assert.rejects(
      tx(db.pool, (c) =>
        startCreditCheck(c, { priceOptionId: o.aufschlag!, customer: who("a@example.org"), answers: good, couponCode: null, sellerUserId: null, purchaseDay: day, offerUrl: url }),
      ),
      /Aufschlag/,
    );
  });

  it("Widerrufserinnerung entfällt nach Storno", async () => {
    const email = "storno@example.org";
    const checkId = await greenCreditCheck(db.pool, o.raten!, email, day);
    const placed = await tx(db.pool, (c) =>
      placeOrder(c, { ...base, priceOptionId: o.raten!, customer: { kind: "privat", ...who(email) }, credit: { checkId, agreed: true, valueCompensation: false } }),
    );
    await db.pool.query(
      `insert into app.order_cancellations (order_id, kind, effective_on, reason, created_by) values ($1, 'ohne_rueckzahlung', current_date, 'Test', 'test')`,
      [placed.orderId],
    );
    await db.pool.query(`update app.mail_outbox set next_attempt_at = now() where to_address = $1`, [email]);
    const sentTo: string[] = [];
    await sendPendingMails(db.pool, async (m) => {
      sentTo.push(`${m.to}|${m.subject}`);
      return { messageId: "test" };
    }, 200);
    const reminder = (
      await db.pool.query(`select sent_at, cancelled_at, cancel_reason from app.mail_outbox where to_address = $1 and purpose = 'ratenkauf_erinnerung'`, [email])
    ).rows[0];
    assert.equal(reminder.sent_at, null);
    assert.ok(reminder.cancelled_at);
    assert.ok(sentTo.some((x) => x.startsWith(`${email}|Dein Ratenzahlungsvertrag`)));
    assert.ok(!sentTo.some((x) => x.startsWith(`${email}|Erinnerung`)));
    // Entfallen bleibt entfallen.
    await assert.rejects(db.pool.query(`update app.mail_outbox set cancelled_at = null, cancel_reason = null where to_address = $1 and purpose = 'ratenkauf_erinnerung'`, [email]));
  });

  it("Unternehmen und kurze Raten brauchen keine Prüfung", async () => {
    const firm = { kind: "unternehmen" as const, company_name: "Firma GmbH", email: "firma@example.org", country: "DE" };
    // Ohne geprüfte USt-IdNr. nur mit Bestätigung, für die gewerbliche Tätigkeit zu kaufen.
    await assert.rejects(tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer: firm })), /gewerbliche/);
    const f = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer: firm, businessPurpose: true }));
    const fo = (await db.pool.query(`select business_purpose_confirmed_at, credit_check_id from app.orders where id = $1`, [f.orderId])).rows[0];
    assert.ok(fo.business_purpose_confirmed_at);
    assert.equal(fo.credit_check_id, null);
    // Mit geprüfter USt-IdNr. ohne Bestätigung.
    await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.raten!, customer: { ...firm, vat_id: "DE123456789" }, vatIdVerified: true }));
    const r = await tx(db.pool, (c) => placeOrder(c, { ...base, priceOptionId: o.kurz!, customer: { kind: "privat", ...who("kurz@example.org") } }));
    const order = (await db.pool.query(`select withdrawal_waiver_at, credit_check_id from app.orders where id = $1`, [r.orderId])).rows[0];
    assert.ok(order.withdrawal_waiver_at);
    assert.equal(order.credit_check_id, null);
  });
});
