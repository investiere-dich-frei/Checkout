import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkVatId, splitVatId } from "../lib/vies";

// Ausgedachte USt-IdNrn. und Antworten.
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("USt-IdNr.-Prüfung", () => {
  it("trennt Land und Nummer, Griechenland als EL", () => {
    assert.deepEqual(splitVatId("at u12 345 678"), { countryCode: "AT", vatNumber: "U12345678" });
    assert.equal(splitVatId("GR123456789").countryCode, "EL");
  });

  it("übernimmt gültig, Abfragenummer, Name und Anschrift", async () => {
    const r = await checkVatId(
      "ATU12345678",
      "DE123456789",
      reply(200, { valid: true, requestIdentifier: "WAPIAAAA", name: "Firma AG", address: "Gasse 2\\n1010 Wien", userError: "VALID" }),
    );
    assert.equal(r.valid, true);
    assert.equal(r.consultationNumber, "WAPIAAAA");
    assert.equal(r.name, "Firma AG");
  });

  it("meldet ungültig und wertet Ausfälle als nicht geprüft", async () => {
    assert.equal((await checkVatId("ATU1", null, reply(200, { valid: false, userError: "INVALID", name: "---" }))).valid, false);
    assert.equal((await checkVatId("ATU1", null, reply(200, { valid: false, userError: "MS_UNAVAILABLE" }))).valid, null);
    assert.equal((await checkVatId("ATU1", null, reply(500, {}))).valid, null);
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    assert.equal((await checkVatId("ATU1", null, broken)).valid, null);
  });
});
