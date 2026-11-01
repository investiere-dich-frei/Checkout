import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { manualPlan, ManualPlanError } from "../src/manual-plan.ts";

const base = { issueDay: "2026-11-01", paymentTermDays: 14 };

describe("Zahlungsplan manueller Bestellungen", () => {
  it("Einmalzahlung ist zum Zahlungsziel fällig", () => {
    assert.deepEqual(manualPlan({ ...base, model: "einmal", totalCents: 299700 }), [
      { seq: 1, label: "Gesamtbetrag", dueDate: "2026-11-15", grossCents: 299700 },
    ]);
  });

  it("Anzahlung und Restzahlung", () => {
    const p = manualPlan({ ...base, model: "anzahlung_rest", totalCents: 300000, firstCents: 100000, nextDueDate: "2026-12-15" });
    assert.deepEqual(
      p.map((x) => [x.label, x.dueDate, x.grossCents]),
      [
        ["Anzahlung", "2026-11-15", 100000],
        ["Restzahlung", "2026-12-15", 200000],
      ],
    );
  });

  it("Raten: Rate 1 plus gleich hohe Folgeraten, Rest auf die letzte, monatlich zum gleichen Tag", () => {
    const p = manualPlan({ ...base, model: "raten", totalCents: 100000, firstCents: 20000, installmentCount: 4, nextDueDate: "2027-01-31" });
    assert.deepEqual(
      p.map((x) => [x.label, x.dueDate, x.grossCents]),
      [
        ["Rate 1 von 4", "2026-11-15", 20000],
        ["Rate 2 von 4", "2027-01-31", 26666],
        ["Rate 3 von 4", "2027-02-28", 26666],
        ["Rate 4 von 4", "2027-03-31", 26668],
      ],
    );
    assert.equal(p.reduce((t, x) => t + x.grossCents, 0), 100000);
  });

  it("Anzahlung und Raten zählt die Raten nach der Anzahlung", () => {
    const p = manualPlan({ ...base, model: "anzahlung_raten", totalCents: 360000, firstCents: 60000, installmentCount: 6, nextDueDate: "2026-12-01" });
    assert.equal(p.length, 7);
    assert.equal(p[0]!.label, "Anzahlung");
    assert.equal(p[6]!.label, "Rate 6 von 6");
    assert.ok(p.slice(1).every((x) => x.grossCents === 50000));
  });

  it("lehnt unstimmige Angaben ab", () => {
    const bad = [
      { model: "einmal" as const, totalCents: 0 },
      { model: "einmal" as const, totalCents: 2_000_001 },
      { model: "anzahlung_rest" as const, totalCents: 1000, firstCents: 1000, nextDueDate: "2026-12-01" },
      { model: "anzahlung_rest" as const, totalCents: 1000, firstCents: 500, nextDueDate: null },
      { model: "anzahlung_rest" as const, totalCents: 1000, firstCents: 500, nextDueDate: "2026-11-10" },
      { model: "raten" as const, totalCents: 1000, firstCents: 500, installmentCount: 25, nextDueDate: "2026-12-01" },
      { model: "raten" as const, totalCents: 1000, firstCents: 999, installmentCount: 3, nextDueDate: "2026-12-01" },
    ];
    for (const b of bad) assert.throws(() => manualPlan({ ...base, ...b }), ManualPlanError, JSON.stringify(b));
    assert.throws(() => manualPlan({ ...base, paymentTermDays: 91, model: "einmal", totalCents: 100 }), ManualPlanError);
  });
});
