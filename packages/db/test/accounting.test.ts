import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildZip, checkPeriod, invoiceLines, invoiceLinesCsv, invoicePdfs, taxReport, taxReportCsv } from "../src/accounting.ts";
import type { SessionUser } from "../src/auth.ts";
import { createTestDb, seed, type Fixture, type TestDb } from "./helpers.ts";

// Ausgedachte Gesellschaft und Kundinnen, keine echten Daten.
describe("Buchhaltung", () => {
  let db: TestDb;
  let f: Fixture;
  const admin: SessionUser = { id: "00000000-0000-0000-0000-000000000001", email: "a@example.org", displayName: "Admin", role: "admin", salesCode: null };
  const period = { from: "2026-10-01", to: "2026-10-31" };

  const issue = async (o: { kind?: string; corrects?: string; day: string; country: string; kindCustomer?: string; vat?: string; net: number; rate: number; note?: string; name?: string }) => {
    const tax = Math.round((o.net * o.rate) / 10000);
    const snap = { kind: o.kindCustomer ?? "privat", first_name: "Erika", last_name: o.name ?? "Muster", company_name: null, email: "e@example.org", country: o.country, vat_id: o.vat ?? null };
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const inv = (
        await c.query(
          `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id, customer_snapshot, company_snapshot,
             issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents)
           values ($1, 0, '', $2, $3, $4, $5, $6, '{"legal_name": "Test GmbH"}', $7, $7, $7, 'EUR', $8, $9, $10) returning id, invoice_number`,
          [f.companyId, o.kind ?? "rechnung", o.corrects ?? null, f.orderId, f.customerId, JSON.stringify(snap), o.day, o.net, tax, o.net + tax],
        )
      ).rows[0];
      await c.query(
        `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
         values ($1, 1, 'Club; "Monat"', 1, $2, $2, $3, $4, $5, $6)`,
        [inv.id, o.net, o.rate, tax, o.net + tax, o.note ?? null],
      );
      await c.query(`insert into app.invoice_documents (invoice_id, pdf, sha256) values ($1, $2, sha256($2))`, [inv.id, Buffer.from(`%PDF-${inv.invoice_number}`)]);
      await c.query("commit");
      return inv as { id: string; invoice_number: string };
    } finally {
      c.release();
    }
  };

  before(async () => {
    db = await createTestDb();
    f = await seed(db.pool, 1);
    const a = await issue({ day: "2026-10-05", country: "DE", net: 10000, rate: 1900 });
    await issue({ day: "2026-10-06", country: "AT", net: 10000, rate: 2000 });
    await issue({ day: "2026-10-07", country: "AT", kindCustomer: "unternehmen", vat: "ATU1", net: 10000, rate: 0, note: "Steuerschuldnerschaft des Leistungsempfängers" });
    await issue({ day: "2026-10-20", kind: "storno", corrects: a.id, country: "DE", net: -10000, rate: 1900 });
    await issue({ day: "2026-11-02", country: "DE", net: 5000, rate: 1900, name: "=HYPERLINK()" });
  });
  after(() => db.drop());

  it("prüft den Zeitraum und die Berechtigung", async () => {
    assert.throws(() => checkPeriod({ from: "2026-10-31", to: "2026-10-01" }), /endet vor/);
    assert.throws(() => checkPeriod({ from: "x", to: "2026-10-01" }), /Datum/);
    await assert.rejects(invoiceLines(db.pool, { ...admin, role: "vertrieb" }, period), /Berechtigung/);
  });

  it("summiert je Land, Satz und Kundenart; Storno zählt negativ; OSS nur EU-Ausland privat", async () => {
    const r = await taxReport(db.pool, admin, period);
    const de = r.find((x) => x.country === "DE")!;
    assert.deepEqual([de.invoices, de.netCents, de.taxCents], [2, 0, 0]);
    const at = r.filter((x) => x.country === "AT");
    assert.deepEqual(
      at.map((x) => [x.taxRateBp, x.business, x.oss, x.taxCents]),
      [
        [2000, false, true, 2000],
        [0, true, false, 0],
      ],
    );
    assert.equal(r[0]!.country, "DE");
  });

  it("schreibt CSV für Excel und DATEV und entschärft Formeln", async () => {
    const csv = invoiceLinesCsv(await invoiceLines(db.pool, admin, { from: "2026-10-01", to: "2026-11-30" }));
    assert.ok(csv.startsWith("﻿Rechnungsnummer;Art;"));
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 6);
    assert.match(lines[1]!, /;Rechnung;;05\.10\.2026;/);
    assert.match(lines[1]!, /;"Club; ""Monat""";19;;100,00;19,00;119,00;EUR;/);
    assert.match(lines[4]!, /;Stornorechnung;/);
    assert.match(lines[4]!, /;-100,00;-19,00;-119,00;/);
    assert.match(lines[5]!, /;'Erika =HYPERLINK\(\)|;Erika =HYPERLINK\(\)/);
    assert.match(taxReportCsv(await taxReport(db.pool, admin, period)), /AT;20;;Privat;ja;1;100,00;20,00;120,00;EUR/);
  });

  it("packt die PDFs des Zeitraums in ein ZIP", async () => {
    const files = await invoicePdfs(db.pool, admin, period);
    assert.equal(files.length, 4);
    assert.match(files[3]!.name, /^Stornorechnung-/);
    const zip = buildZip(files);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 12), 4);
  });
});
