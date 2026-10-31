import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyDiscount, describeDiscount, DiscountError, discountedPlan, discountOn, normalizeCode, type Discount } from "../src/discount.ts";
import { paymentSchedule, type PricePlan } from "../src/pricing.ts";

const pct = (bp: number, scope: Discount["scope"] = "erste"): Discount => ({ kind: "prozent", percentBp: bp, amountCents: null, scope });
const fix = (cents: number, scope: Discount["scope"] = "erste"): Discount => ({ kind: "betrag", percentBp: null, amountCents: cents, scope });

describe("Gutscheine: Rabattrechnung", () => {
  it("rundet Prozent kaufmännisch und begrenzt feste Beträge", () => {
    assert.equal(discountOn(9900, pct(1000)), 990);
    assert.equal(discountOn(3109, pct(1250)), 389); // 388,625 → 389
    assert.equal(discountOn(5000, fix(2000)), 2000);
    assert.equal(discountOn(0, fix(2000)), 0);
  });

  it("erste: nur die erste Zahlung mit Betrag; alle: jede Zahlung", () => {
    const raten: PricePlan = { kind: "raten", amountCents: 10000, recurringAmountCents: 10000, recurringCount: 2, intervalMonths: 1, trialDays: null };
    const s = paymentSchedule(raten, "2026-11-01");
    assert.deepEqual(applyDiscount(s, pct(1000)).map((p) => p.amountCents), [9000, 10000, 10000]);
    assert.deepEqual(applyDiscount(s, pct(1000, "alle")).map((p) => p.amountCents), [9000, 9000, 9000]);
    assert.deepEqual(applyDiscount(s, fix(2500, "alle")).map((p) => p.listAmountCents), [10000, 10000, 10000]);
  });

  it("Probezeit ohne Anzahlung: erste Zahlung ist die erste Folgezahlung", () => {
    const abo: PricePlan = { kind: "abo", amountCents: 0, recurringAmountCents: 6900, recurringCount: null, intervalMonths: 1, trialDays: 14 };
    const s = paymentSchedule(abo, "2026-11-01", 2);
    assert.deepEqual(applyDiscount(s, fix(1900)).map((p) => p.amountCents), [5000, 6900]);
    const terms = discountedPlan(abo, fix(1900, "alle"));
    assert.equal(terms.amountCents, 0);
    assert.equal(terms.recurringAmountCents, 5000);
    assert.equal(discountedPlan(abo, fix(1900)), abo);
  });

  it("lehnt Rabatte ab, die eine Zahlung unter 1 € drücken", () => {
    const s = [{ dueDate: "2026-11-01", amountCents: 3700 }];
    assert.throws(() => applyDiscount(s, fix(3650)), DiscountError);
    assert.throws(() => applyDiscount(s, pct(10000)), DiscountError);
    assert.equal(applyDiscount(s, fix(3600))[0]!.amountCents, 100);
  });

  it("beschreibt Rabatte und vereinheitlicht Codes", () => {
    assert.equal(describeDiscount(pct(1250)), "12,5 % Rabatt");
    assert.equal(describeDiscount(fix(2000)), "20,00 € Rabatt");
    assert.equal(describeDiscount(fix(2000), "EUR", "netto"), "20,00 € netto Rabatt");
    assert.equal(normalizeCode(" herbst 20 "), "HERBST20");
  });
});
