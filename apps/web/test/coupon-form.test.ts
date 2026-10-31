import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { couponFromForm, parsePercent } from "../lib/coupon-form.ts";
import { previewPrice } from "../lib/price-preview.ts";

describe("Gutscheine im Formular und in der Preisvorschau", () => {
  it("liest Prozent und Beträge wie getippt", () => {
    assert.equal(parsePercent("10"), 1000);
    assert.equal(parsePercent("12,5 %"), 1250);
    assert.equal(parsePercent(""), null);
    assert.throws(() => parsePercent("abc"));
    const f = new FormData();
    f.set("code", "herbst20");
    f.set("kind", "betrag");
    f.set("amount", "20,50");
    f.set("scope", "alle");
    f.append("product_ids", "00000000-0000-0000-0000-000000000001");
    f.set("max_redemptions", "5");
    const c = couponFromForm(f);
    assert.equal(c.amountCents, 2050);
    assert.equal(c.percentBp, null);
    assert.equal(c.allProducts, false);
    assert.deepEqual(c.productIds, ["00000000-0000-0000-0000-000000000001"]);
    assert.equal(c.maxRedemptions, 5);
  });

  it("Vorschau zeigt denselben Preis wie die Bestellung", () => {
    const p = previewPrice({
      plan: { kind: "raten", amountCents: 5000, recurringAmountCents: 5000, recurringCount: 2, intervalMonths: 1, trialDays: null },
      amountBasis: "brutto",
      taxCategory: "standard",
      chVatRateBp: null,
      country: "DE",
      isBusiness: false,
      purchaseDay: "2026-11-02",
      discount: { kind: "prozent", percentBp: 1000, amountCents: null, scope: "alle" },
    });
    assert.equal(p.dueNowCents, 4500);
    assert.equal(p.recurringCents, 4500);
    assert.equal(p.totalCents, 13500);
    assert.equal(p.savingsCents, 1500);
  });
});
