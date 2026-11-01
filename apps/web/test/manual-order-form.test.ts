import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManualOrderError } from "@idf/db/manual-orders";
import { manualOrderFromForm } from "../lib/manual-order-form";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const base = {
  product_id: "p1",
  kind: "privat",
  first_name: "Erika",
  last_name: "Muster",
  email: "erika@example.org",
  street: "Weg 1",
  postal_code: "12345",
  city: "Musterstadt",
  country: "DE",
  payment_model: "einmal",
  total: "2.997,00",
  payment_term_days: "14",
  send_mail: "on",
};

describe("Formular manuelle Bestellung", () => {
  it("liest Kundin, Betrag und Plan", () => {
    const r = manualOrderFromForm(form(base), "2026-11-01");
    assert.equal(r.plan.totalCents, 299700);
    assert.equal(r.plan.model, "einmal");
    assert.equal(r.plan.firstCents, null);
    assert.equal(r.sendMail, true);
    assert.equal(r.alreadyPaid, null);
    assert.equal(r.customer.company_name, null);
  });

  it("Raten mit Anzahlung und bereits eingegangener Zahlung", () => {
    const r = manualOrderFromForm(
      form({ ...base, payment_model: "raten", first: "500", installment_count: "6", next_due_date: "2026-12-01", already_paid: "on", paid_on: "2026-11-01" }),
      "2026-11-01",
    );
    assert.deepEqual(r.plan, { model: "raten", totalCents: 299700, firstCents: 50000, installmentCount: 6, nextDueDate: "2026-12-01", paymentTermDays: 14 });
    assert.deepEqual(r.alreadyPaid, { paidOn: "2026-11-01", reference: "" });
  });

  it("meldet fehlende und falsche Angaben verständlich", () => {
    assert.throws(() => manualOrderFromForm(form({ ...base, street: "" }), "2026-11-01"), /Straße/);
    assert.throws(() => manualOrderFromForm(form({ ...base, email: "x" }), "2026-11-01"), ManualOrderError);
    assert.throws(() => manualOrderFromForm(form({ ...base, total: "abc" }), "2026-11-01"), /Gesamtbetrag/);
    assert.throws(() => manualOrderFromForm(form({ ...base, payment_model: "abo" }), "2026-11-01"), /Zahlungsmodell/);
    assert.throws(() => manualOrderFromForm(form({ ...base, kind: "unternehmen" }), "2026-11-01"), /Firma/);
  });
});
