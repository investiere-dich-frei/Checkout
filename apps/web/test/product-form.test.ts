import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductError } from "@idf/db/products";
import { centsToInput, parseEuro, priceOptionFromForm, productFromForm } from "../lib/product-form";
import { slugFromName } from "../lib/slug";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("Produktformular", () => {
  it("liest Euro-Beträge in deutscher und englischer Schreibweise", () => {
    assert.equal(parseEuro("37"), 3700);
    assert.equal(parseEuro("37,5"), 3750);
    assert.equal(parseEuro("1.234,56 €"), 123456);
    assert.equal(parseEuro("1234.56"), 123456);
    assert.equal(parseEuro("1,497.00"), 149700);
    assert.equal(parseEuro(" "), null);
    assert.throws(() => parseEuro("12,345"), ProductError);
    assert.throws(() => parseEuro("-5"), ProductError);
    assert.equal(centsToInput(149700), "1497");
    assert.equal(centsToInput(3750), "37,50");
    assert.equal(centsToInput(5), "0,05");
  });

  it("schlägt eine Adresse aus dem Namen vor", () => {
    assert.equal(slugFromName("Dein Finanz-Kompass"), "dein-finanz-kompass");
    assert.equal(slugFromName("  Börse für Anfänger: Café & Co. "), "boerse-fuer-anfaenger-cafe-co");
  });

  it("übernimmt nur die Felder der gewählten Zahlart", () => {
    const once = priceOptionFromForm(
      form({ label: "Einmal", kind: "einmal", amount_basis: "brutto", amount: "37", recurring_amount: "10", recurring_count: "x", interval_months: "1" }),
    );
    assert.deepEqual(once, { label: "Einmal", kind: "einmal", amountBasis: "brutto", amountCents: 3700, recurringAmountCents: null, recurringCount: null, intervalMonths: null, trialDays: null });
    const abo = priceOptionFromForm(form({ label: "Abo", kind: "abo", amount_basis: "netto", amount: "", recurring_amount: "9,90", recurring_count: "3", interval_months: "1", trial_days: "14" }));
    assert.equal(abo.amountCents, 0);
    assert.equal(abo.recurringAmountCents, 990);
    assert.equal(abo.recurringCount, null);
    assert.equal(abo.trialDays, 14);
    assert.throws(() => priceOptionFromForm(form({ kind: "raten", recurring_count: "zwei" })), /ganze Zahl/);
    const p = productFromForm(form({ name: "Kurs", slug: "kurs", tax_category: "steuerfrei_4_21", immediate_access: "on" }));
    assert.deepEqual(p, { name: "Kurs", slug: "kurs", internalLabel: null, taxCategory: "steuerfrei_4_21", immediateAccess: true });
  });
});
