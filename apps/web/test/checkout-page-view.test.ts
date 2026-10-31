import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textOn } from "../lib/checkout-page-view";

describe("Kaufseite: Schriftfarbe auf der Akzentfarbe", () => {
  it("wählt die besser lesbare Schrift", () => {
    assert.equal(textOn("#a26766"), "#ffffff");
    assert.equal(textOn("#000000"), "#ffffff");
    assert.equal(textOn("#f5e6c8"), "#222222");
    assert.equal(textOn("#ffffff"), "#222222");
  });
});
