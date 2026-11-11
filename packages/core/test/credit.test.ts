import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessQuestionnaire, classifyCredit, creditWithdrawalEnd, DEFAULT_CREDIT_RULES, type CreditAnswers } from "../src/credit.ts";
import type { PricePlan } from "../src/pricing.ts";

const plan = (p: Partial<PricePlan>): PricePlan => ({
  kind: "raten",
  amountCents: 0,
  recurringAmountCents: null,
  recurringCount: null,
  intervalMonths: null,
  trialDays: null,
  ...p,
});

describe("Ratenkauf als Kredit", () => {
  const day = "2026-11-20";

  it("Einmalzahlung und Abo ohne Ende sind kein Kredit", () => {
    assert.equal(classifyCredit(plan({ kind: "einmal", amountCents: 499700 }), day).isCredit, false);
    assert.equal(classifyCredit(plan({ kind: "abo", amountCents: 6900, recurringAmountCents: 6900, intervalMonths: 1 }), day).isCredit, false);
  });

  it("Raten über 50 Tage sind ein Kredit, auch zinsfrei", () => {
    const c = classifyCredit(plan({ amountCents: 41642, recurringAmountCents: 41641, recurringCount: 11, intervalMonths: 1 }), day, 499700);
    assert.equal(c.isCredit, true);
    assert.equal(c.surchargeCents, 0);
    assert.equal(c.dueNowCents, 41642);
    assert.equal(c.creditCents, 11 * 41641);
    assert.equal(c.monthlyRateCents, 41641);
    assert.equal(c.lastDueDate, "2027-10-20");
  });

  it("0 € Anzahlung und Raten alle 3 Monate: Monatsbelastung ist ein Drittel", () => {
    const c = classifyCredit(plan({ kind: "anzahlung", amountCents: 0, recurringAmountCents: 249850, recurringCount: 2, intervalMonths: 3 }), day, 499700);
    assert.equal(c.isCredit, true);
    assert.equal(c.creditCents, 499700);
    assert.equal(c.monthlyRateCents, 83284);
  });

  it("bis 50 Tage ohne Aufschlag: kein Kredit; mit Aufschlag: Kredit", () => {
    const short = plan({ kind: "anzahlung", amountCents: 50000, recurringAmountCents: 50000, recurringCount: 1, intervalMonths: 1, trialDays: 50 });
    assert.equal(classifyCredit(short, day, 100000).isCredit, false);
    const dearer = classifyCredit(short, day, 90000);
    assert.equal(dearer.isCredit, true);
    assert.equal(dearer.surchargeCents, 10000);
    assert.equal(classifyCredit({ ...short, trialDays: 51 }, day, 100000).isCredit, true);
  });

  it("vor dem 20.11.2026 gilt altes Recht", () => {
    const p = plan({ amountCents: 10000, recurringAmountCents: 10000, recurringCount: 11, intervalMonths: 1 });
    assert.equal(classifyCredit(p, "2026-11-19").isCredit, false);
    assert.equal(classifyCredit(p, "2026-11-20").isCredit, true);
  });

  it("Widerrufsfrist: 14 Tage ab Vertragsschluss", () => {
    assert.equal(creditWithdrawalEnd("2026-11-25"), "2026-12-09");
  });
});

describe("Bonitätsprüfung per Fragebogen", () => {
  const a: CreditAnswers = { employment: "angestellt", netIncomeCents: 300_000, housingCents: 100_000, otherCreditsCents: 20_000, dependents: 1, paymentProblems: false };
  const r = DEFAULT_CREDIT_RULES;

  it("grün, wenn die Rate höchstens die Hälfte des freien Einkommens ist", () => {
    // frei: 3.000 − 1.000 − 200 − 600 − 400 = 800 €
    const x = assessQuestionnaire(a, { monthlyRateCents: 40_000, creditCents: 440_000 }, r);
    assert.equal(x.freeIncomeCents, 80_000);
    assert.equal(x.result, "gruen");
  });

  it("gelb bei knapper Rate, ohne Beschäftigung oder über der Prüfgrenze", () => {
    assert.equal(assessQuestionnaire(a, { monthlyRateCents: 40_001, creditCents: 1 }, r).result, "gelb");
    assert.equal(assessQuestionnaire({ ...a, employment: "ohne" }, { monthlyRateCents: 100, creditCents: 1 }, r).result, "gelb");
    const review = assessQuestionnaire(a, { monthlyRateCents: 100, creditCents: 500_000 }, { ...r, manualReviewFromCents: 200_000 });
    assert.equal(review.result, "gelb");
    const bureau = assessQuestionnaire(a, { monthlyRateCents: 100, creditCents: 500_000 }, { ...r, bureauFromCents: 200_000 });
    assert.deepEqual([bureau.result, bureau.needsBureau], ["gelb", true]);
  });

  it("rot bei Zahlungsproblemen oder wenn die Rate nicht ins freie Einkommen passt", () => {
    assert.equal(assessQuestionnaire({ ...a, paymentProblems: true }, { monthlyRateCents: 100, creditCents: 1 }, r).result, "rot");
    assert.equal(assessQuestionnaire(a, { monthlyRateCents: 80_001, creditCents: 1 }, r).result, "rot");
    assert.equal(assessQuestionnaire({ ...a, netIncomeCents: 100_000 }, { monthlyRateCents: 1, creditCents: 1 }, r).result, "rot");
  });
});
