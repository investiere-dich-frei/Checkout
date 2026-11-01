import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestDb, issueInvoice, seed, tx, type Fixture, type TestDb } from "./helpers.ts";

const GOBD = /GoBD/;

describe("Rechnungen nach GoBD", () => {
  let db: TestDb;
  let f: Fixture;

  before(async () => {
    db = await createTestDb();
    f = await seed(db.pool);
  });
  after(() => db.drop());

  it("vergibt Nummern ab dem Startwert lückenlos, auch nach einem Rollback", async () => {
    const a = await tx(db.pool, (c) => issueInvoice(c, f));
    assert.equal(a.invoice_number, "7981");

    await assert.rejects(
      tx(db.pool, async (c) => {
        await issueInvoice(c, f);
        throw new Error("Abbruch mitten in der Ausstellung");
      }),
    );

    const b = await tx(db.pool, (c) => issueInvoice(c, f));
    assert.equal(b.invoice_number, "7982");
  });

  it("ignoriert von außen gesetzte Nummern", async () => {
    const inv = await tx(db.pool, async (c) => {
      const r = await issueInvoice(c, f);
      return (await c.query("select number_seq from app.invoices where id = $1", [r.id])).rows[0];
    });
    assert.notEqual(inv.number_seq, "0");
  });

  it("vergibt bei paralleler Ausstellung eindeutige, fortlaufende Nummern", async () => {
    const before = (await db.pool.query("select max(number_seq)::int m from app.invoices")).rows[0].m as number;
    const results = await Promise.all(Array.from({ length: 8 }, () => tx(db.pool, (c) => issueInvoice(c, f))));
    const nums = results.map((r) => Number(r.number_seq)).sort((x, y) => x - y);
    assert.deepEqual(
      nums,
      Array.from({ length: 8 }, (_, i) => before + 1 + i),
    );
  });

  it("verbietet Ändern und Löschen ausgestellter Rechnungen", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    await assert.rejects(db.pool.query("update app.invoices set gross_cents = 1 where id = $1", [inv.id]), GOBD);
    await assert.rejects(db.pool.query("update app.invoices set note = 'x' where id = $1", [inv.id]), GOBD);
    await assert.rejects(db.pool.query("delete from app.invoices where id = $1", [inv.id]), GOBD);
    await assert.rejects(db.pool.query("truncate app.invoices cascade"), GOBD);
    await assert.rejects(db.pool.query("update app.invoice_items set description = 'x' where invoice_id = $1", [inv.id]), GOBD);
    await assert.rejects(db.pool.query("delete from app.invoice_items where invoice_id = $1", [inv.id]), GOBD);
  });

  it("erlaubt das PDF genau einmal nachzutragen", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    await db.pool.query(
      "update app.invoices set pdf_sha256 = sha256('pdf'), pdf_storage_key = 'rechnungen/1.pdf' where id = $1",
      [inv.id],
    );
    await assert.rejects(
      db.pool.query("update app.invoices set pdf_sha256 = sha256('anders'), pdf_storage_key = 'x' where id = $1", [
        inv.id,
      ]),
      GOBD,
    );
  });

  it("lässt keine Positionen in einer späteren Transaktion zu", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    await assert.rejects(
      db.pool.query(
        `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents)
         values ($1, 2, 'Nachtrag', 1, 100, 100, 1900, 19, 119)`,
        [inv.id],
      ),
      GOBD,
    );
  });

  it("weist Rechnungen ohne Positionen oder mit falschen Summen beim Commit ab", async () => {
    await assert.rejects(
      tx(db.pool, (c) =>
        c.query(
          `insert into app.invoices (company_id, number_seq, invoice_number, kind, order_id, customer_id, customer_snapshot, company_snapshot,
             issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents)
           values ($1, 0, '', 'rechnung', $2, $3, '{}', '{}', current_date, current_date, current_date, 'EUR', 100, 19, 119)`,
          [f.companyId, f.orderId, f.customerId],
        ),
      ),
      /keine Positionen/,
    );
    await assert.rejects(
      tx(db.pool, async (c) => {
        const inv = await issueInvoice(c, f);
        await c.query(
          `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents)
           values ($1, 2, 'Zusatz', 1, 100, 100, 1900, 19, 119)`,
          [inv.id],
        );
      }),
      /passen nicht/,
    );
  });

  it("verlangt bei Steuerbefreiung einen Hinweis auf der Position", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f, { taxRateBp: 0 }));
    const item = (await db.pool.query("select tax_exemption_note from app.invoice_items where invoice_id = $1", [inv.id]))
      .rows[0];
    assert.match(item.tax_exemption_note, /§ 4 Nr. 21 UStG/);
    await assert.rejects(
      tx(db.pool, async (c) => {
        const r = await issueInvoice(c, f);
        await c.query(
          `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents)
           values ($1, 2, 'ohne Hinweis', 1, 100, 100, 0, 0, 100)`,
          [r.id],
        );
      }),
      /invoice_items_check/,
    );
  });

  it("korrigiert nur per Storno über den vollen Betrag, höchstens einmal", async () => {
    const inv = await tx(db.pool, (c) => issueInvoice(c, f));
    await assert.rejects(
      tx(db.pool, (c) => issueInvoice(c, f, { kind: "storno", correctsInvoiceId: inv.id, netCents: -5000 })),
      /vollen Betrag/,
    );
    const storno = await tx(db.pool, (c) => issueInvoice(c, f, { kind: "storno", correctsInvoiceId: inv.id, netCents: -10000 }));
    assert.ok(Number(storno.number_seq) > Number(inv.number_seq));
    await assert.rejects(
      tx(db.pool, (c) => issueInvoice(c, f, { kind: "storno", correctsInvoiceId: inv.id, netCents: -10000 })),
      /invoices_one_storno_idx|übersteigen/,
    );
  });

  it("lässt den Nummernkreis nicht zurückstellen", async () => {
    await assert.rejects(
      db.pool.query("update app.invoice_number_series set next_value = 1 where company_id = $1", [f.companyId]),
      GOBD,
    );
    await assert.rejects(db.pool.query("delete from app.invoice_number_series where company_id = $1", [f.companyId]), GOBD);
  });
});
