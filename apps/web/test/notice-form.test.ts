import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNoticeForm } from "../lib/notice-form";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

// Ausgedachte Angaben, keine echten Kundendaten.
const base = { full_name: "Erika Muster", email: "erika@example.org", contract_reference: "IDF-12" };

describe("Kündigungs- und Widerrufsformular", () => {
  it("nimmt eine ordentliche Kündigung zum nächstmöglichen Zeitpunkt an", () => {
    const r = parseNoticeForm("kuendigung", form({ ...base, cancellation_type: "ordentlich", end: "naechstmoeglich" }), "2026-11-02");
    assert.ok(r.ok);
    assert.equal(r.value.cancellationType, "ordentlich");
    assert.equal(r.value.requestedEnd, null);
  });

  it("verlangt Grund und gültiges Datum, wenn gewählt", () => {
    const r = parseNoticeForm(
      "kuendigung",
      form({ ...base, cancellation_type: "ausserordentlich", end: "datum", end_date: "2026-11-01" }),
      "2026-11-02",
    );
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.errors).sort(), ["end_date", "reason"]);
  });

  it("braucht für den Widerruf nur Name, E-Mail und Vertrag", () => {
    assert.ok(parseNoticeForm("widerruf", form(base), "2026-11-02").ok);
    const r = parseNoticeForm("widerruf", form({ email: "kein-at" }), "2026-11-02");
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.errors).sort(), ["contract_reference", "email", "full_name"]);
  });
});
