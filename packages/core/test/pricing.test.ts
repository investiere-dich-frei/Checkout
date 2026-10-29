import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMonths, paymentSchedule, splitAmount, totalCents, type PricePlan } from "../src/pricing.ts";

const plan = (p: Partial<PricePlan>): PricePlan => ({
  kind: "einmal",
  amountCents: 0,
  recurringAmountCents: null,
  recurringCount: null,
  intervalMonths: null,
  trialDays: null,
  ...p,
});

describe("Beträge", () => {
  it("rechnet Netto zu Brutto mit kaufmännischer Rundung", () => {
    assert.deepEqual(splitAmount(3109, "netto", 1900), { netCents: 3109, taxCents: 591, grossCents: 3700 });
    assert.deepEqual(splitAmount(20750, "netto", 2000), { netCents: 20750, taxCents: 4150, grossCents: 24900 });
    assert.deepEqual(splitAmount(1, "netto", 5000), { netCents: 1, taxCents: 1, grossCents: 2 });
  });

  it("hält Bruttopreise exakt", () => {
    const a = splitAmount(3700, "brutto", 1900);
    assert.deepEqual(a, { netCents: 3109, taxCents: 591, grossCents: 3700 });
    for (let gross = 0; gross < 5000; gross += 7) {
      const s = splitAmount(gross, "brutto", 1900);
      assert.equal(s.netCents + s.taxCents, gross);
    }
  });

  it("lässt steuerfreie Beträge unverändert", () => {
    assert.deepEqual(splitAmount(499700, "netto", 0), { netCents: 499700, taxCents: 0, grossCents: 499700 });
  });

  it("lehnt Bruchteile von Cent und negative Beträge ab", () => {
    assert.throws(() => splitAmount(1.5, "netto", 1900));
    assert.throws(() => splitAmount(-1, "netto", 1900));
    assert.throws(() => splitAmount(100, "netto", 10001));
  });
});

describe("Zahlpläne", () => {
  it("Einmalzahlung: eine Zahlung am Kauftag", () => {
    assert.deepEqual(paymentSchedule(plan({ amountCents: 499700 }), "2026-11-03"), [
      { dueDate: "2026-11-03", amountCents: 499700 },
    ]);
  });

  it("Raten: Monatsende wandert nicht ab", () => {
    const p = plan({ kind: "raten", amountCents: 100, recurringAmountCents: 100, recurringCount: 3, intervalMonths: 1 });
    assert.deepEqual(
      paymentSchedule(p, "2027-01-31").map((x) => x.dueDate),
      ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
    );
    assert.equal(totalCents(p), 400);
  });

  it("Probezeit ohne erste Zahlung: erste Rate nach Ablauf", () => {
    const p = plan({ kind: "raten", recurringAmountCents: 249850, recurringCount: 2, intervalMonths: 3, trialDays: 42 });
    assert.deepEqual(paymentSchedule(p, "2026-11-01"), [
      { dueDate: "2026-12-13", amountCents: 249850 },
      { dueDate: "2027-03-13", amountCents: 249850 },
    ]);
  });

  it("Anzahlung mit Probezeit bis zur ersten Folgerate", () => {
    const p = plan({ kind: "anzahlung", amountCents: 100000, recurringAmountCents: 99930, recurringCount: 4, intervalMonths: 1, trialDays: 30 });
    const s = paymentSchedule(p, "2026-11-01");
    assert.equal(s.length, 5);
    assert.deepEqual(s[1], { dueDate: "2026-12-01", amountCents: 99930 });
    assert.equal(totalCents(p), 499720);
  });

  it("Abo: begrenzte Vorschau, kein Gesamtpreis", () => {
    const p = plan({ kind: "abo", amountCents: 9900, recurringAmountCents: 9900, intervalMonths: 12 });
    const s = paymentSchedule(p, "2028-02-29", 3);
    assert.deepEqual(s.map((x) => x.dueDate), ["2028-02-29", "2029-02-28", "2030-02-28"]);
    assert.equal(totalCents(p), null);
  });

  it("addMonths über den Jahreswechsel", () => {
    assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  });
});
