import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCheckoutForm } from "../lib/checkout-form";
import { todayBerlin } from "../lib/format";
import { previewPrice } from "../lib/price-preview";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

// Ausgedachte Angaben, keine echten Kundendaten.
const valid = {
  kind: "privat",
  first_name: "Erika",
  last_name: "Muster",
  email: "erika@example.org",
  street: "Musterweg 1",
  postal_code: "12345",
  city: "Musterstadt",
  country: "de",
  terms: "on",
  waiver: "on",
};

describe("Checkout-Formular", () => {
  it("nimmt vollständige Angaben an", () => {
    const r = parseCheckoutForm(form(valid));
    assert.ok(r.ok);
    assert.equal(r.value.customer.country, "DE");
    assert.equal(r.value.customer.company_name, null);
    assert.equal(r.value.withdrawalWaiver, true);
  });

  it("lässt den Sofortstart freiwillig", () => {
    const r = parseCheckoutForm(form({ ...valid, waiver: "" }));
    assert.ok(r.ok);
    assert.equal(r.value.withdrawalWaiver, false);
  });

  it("meldet fehlende Pflichtangaben und Zustimmungen einzeln", () => {
    const r = parseCheckoutForm(form({ ...valid, email: "kein-at", terms: "", waiver: "", country: "XX" }));
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.errors).sort(), ["country", "email", "terms"]);
  });

  it("verlangt bei Unternehmen den Firmennamen und prüft das Format der USt-IdNr.", () => {
    const r = parseCheckoutForm(form({ ...valid, kind: "unternehmen", vat_id: "12" }));
    assert.ok(!r.ok);
    assert.ok(r.errors.company_name && r.errors.vat_id);
    const ok = parseCheckoutForm(form({ ...valid, kind: "unternehmen", company_name: "Firma", vat_id: "at u 123 456 78" }));
    assert.ok(ok.ok);
    assert.equal(ok.value.customer.vat_id, "ATU12345678");
  });
});

describe("Preisanzeige", () => {
  const plan = { kind: "raten" as const, amountCents: 166567, recurringAmountCents: 166567, recurringCount: 2, intervalMonths: 1, trialDays: null };

  it("zeigt in DE den steuerfreien, in AT den Bruttopreis mit 20 %", () => {
    const base = { plan, amountBasis: "netto" as const, taxCategory: "steuerfrei_4_21" as const, chVatRateBp: null, isBusiness: false, purchaseDay: "2026-11-02" };
    const de = previewPrice({ ...base, country: "DE" });
    assert.deepEqual([de.dueNowCents, de.totalCents, de.rateBp], [166567, 499701, 0]);
    const at = previewPrice({ ...base, country: "AT" });
    assert.deepEqual([at.dueNowCents, at.totalCents, at.rateBp], [199880, 599640, 2000]);
  });

  it("zeigt nie Reverse Charge, solange die USt-IdNr. ungeprüft ist", () => {
    const p = previewPrice({ plan, amountBasis: "netto", taxCategory: "standard", chVatRateBp: null, country: "AT", isBusiness: true, purchaseDay: "2026-11-02" });
    assert.equal(p.rateBp, 2000);
  });

  it("Kauftag in Europe/Berlin", () => {
    assert.equal(todayBerlin(new Date("2026-10-31T23:30:00Z")), "2026-11-01");
    assert.equal(todayBerlin(new Date("2026-06-30T21:59:00Z")), "2026-06-30");
  });
});
