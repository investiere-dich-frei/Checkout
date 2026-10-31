import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTestkaufArgs } from "../lib/testkauf";

describe("Testkauf-Argumente", () => {
  const option = "426ebd8b-d9c2-483f-b49f-bfcbaf730111";
  it("liest Option, Adresse und Test-Zahlungsart", () => {
    assert.deepEqual(parseTestkaufArgs(["--option", option, "--email=test@example.org", "--karte", "pm_card_chargeCustomerFail"]), {
      option,
      email: "test@example.org",
      karte: "pm_card_chargeCustomerFail",
    });
    assert.equal(parseTestkaufArgs(["--option", option, "--email", "test@example.org"]).karte, "pm_card_visa");
  });
  it("nimmt keine Kartennummern und keine ungültigen Angaben", () => {
    assert.throws(() => parseTestkaufArgs(["--option", option, "--email", "test@example.org", "--karte", "4242424242424242"]), /Test-Zahlungsart/);
    assert.throws(() => parseTestkaufArgs(["--option", "x", "--email", "test@example.org"]), /Preisoption/);
    assert.throws(() => parseTestkaufArgs(["--option", option]), /E-Mail/);
  });
});
