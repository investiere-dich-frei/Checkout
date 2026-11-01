import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMailHtml } from "../src/mail-html.ts";

// Ausgedachte Angaben, keine echten Kundendaten.
describe("Gestaltete Kundenmail", () => {
  const text = [
    "Hallo Erika <Muster>,",
    "",
    "danke für deine Zahlung.",
    "",
    "Zahlplan",
    "- 01.11.2026: 208,21 €",
    "- 01.12.2026: 208,21 €",
    "",
    "Zur Bestellung: https://kasse.example.org/bestellung/1?a=1&b=2",
    "Mehr unter https://example.org/hilfe.",
    "",
    "Widerrufsbelehrung (Fassung 3.1)",
    "",
    "Test GmbH",
    "Teststr. 1",
    "10115 Berlin",
  ].join("\n");
  const html = renderMailHtml("Betreff <1>", text);

  it("setzt Überschriften, Aufzählungen, Knöpfe und Links", () => {
    assert.match(html, /<h2[^>]*>Zahlplan<\/h2><ul[^>]*><li[^>]*>01\.11\.2026: 208,21 €<\/li>/);
    assert.match(html, /<h2[^>]*>Widerrufsbelehrung \(Fassung 3\.1\)<\/h2>/);
    assert.match(html, /<a href="https:\/\/kasse\.example\.org\/bestellung\/1\?a=1&amp;b=2"[^>]*>Zur Bestellung<\/a>/);
    assert.match(html, /<a href="https:\/\/example\.org\/hilfe"[^>]*>https:\/\/example\.org\/hilfe<\/a>\./);
  });

  it("maskiert Eingaben und setzt die Anschrift klein darunter", () => {
    assert.ok(html.includes("Hallo Erika &lt;Muster&gt;,"));
    assert.ok(html.includes("<title>Betreff &lt;1&gt;</title>"));
    assert.ok(!html.includes("<Muster>"));
    assert.match(html, /font-size:12px[^>]*>Test GmbH<br>Teststr\. 1<br>10115 Berlin<\/td>/);
    assert.ok(html.includes('src="cid:idf-logo"'));
  });
});
