import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideTax, NOTE_EXEMPT_4_21, NOTE_NOT_TAXABLE, NOTE_REVERSE_CHARGE, type Buyer } from "../src/tax.ts";

const consumer = (country: string): Buyer => ({ country, isBusiness: false, vatIdVerified: false });
const noCh = { chVatRateBp: null };

describe("Umsatzsteuer", () => {
  it("DE: 19 % oder steuerfrei nach § 4 Nr. 21", () => {
    assert.equal(decideTax("standard", consumer("DE"), noCh).rateBp, 1900);
    const exempt = decideTax("steuerfrei_4_21", consumer("de"), noCh);
    assert.deepEqual([exempt.rateBp, exempt.note, exempt.rule], [0, NOTE_EXEMPT_4_21, "de_exempt_4_21"]);
  });

  it("AT-Verbraucher: 20 %, auch bei Produkten, die in DE steuerfrei sind", () => {
    for (const cat of ["standard", "steuerfrei_4_21"] as const) {
      const d = decideTax(cat, consumer("AT"), noCh);
      assert.deepEqual([d.rateBp, d.rule], [2000, "eu_oss"]);
    }
  });

  it("EU-Unternehmen mit geprüfter USt-IdNr.: Reverse Charge", () => {
    const d = decideTax("standard", { country: "AT", isBusiness: true, vatIdVerified: true }, noCh);
    assert.deepEqual([d.rateBp, d.note], [0, NOTE_REVERSE_CHARGE]);
    // Ohne geprüfte Nummer wie Verbraucher.
    assert.equal(decideTax("standard", { country: "AT", isBusiness: true, vatIdVerified: false }, noCh).rateBp, 2000);
  });

  it("CH: ohne Registrierung nicht steuerbar, mit Registrierung Schweizer Satz", () => {
    const d = decideTax("standard", consumer("CH"), noCh);
    assert.deepEqual([d.rateBp, d.note], [0, NOTE_NOT_TAXABLE]);
    assert.equal(decideTax("standard", consumer("CH"), { chVatRateBp: 810 }).rateBp, 810);
  });

  it("Drittland: nicht steuerbar, immer mit Hinweistext", () => {
    const d = decideTax("standard", consumer("US"), noCh);
    assert.equal(d.rateBp, 0);
    assert.ok(d.note);
  });
});
