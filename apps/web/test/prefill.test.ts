import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sign } from "@idf/db/webhooks";
import { fetchPrefill, PREFILL_TIMEOUT_MS } from "../lib/prefill";

// Ausgedachte Personen, Token und Geheimnisse.
const TOKEN = "A".repeat(20) + "b-_" + "9".repeat(20);
const env = { LERNPLATTFORM_URL: "https://lernen.example.test/", LERNPLATTFORM_SIGNATUR_GEHEIMNIS: "test-geheimnis" };
const NOW = 1_800_000_000_000;

type Call = { url: string; init: RequestInit };
function recorder(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

describe("Vorausfüllen aus der Lernplattform", () => {
  it("fragt signiert an und übernimmt Vorname, Nachname und E-Mail", async () => {
    const { calls, fn } = recorder(200, { vorname: " Erika ", nachname: "Muster", email: "erika@example.test" });
    const r = await fetchPrefill(TOKEN, env, fn, () => NOW);
    assert.deepEqual(r, { first_name: "Erika", last_name: "Muster", email: "erika@example.test" });

    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, "https://lernen.example.test/api/v1/kasse/vorausfuellen");
    assert.equal(init.method, "POST");
    assert.equal(init.body, `{"token":"${TOKEN}"}`);
    assert.equal(init.cache, "no-store");
    const h = init.headers as Record<string, string>;
    assert.equal(h["content-type"], "application/json");
    assert.equal(h["x-idf-timestamp"], "1800000000");
    assert.equal(h["x-idf-signature"], sign("test-geheimnis", 1_800_000_000, `{"token":"${TOKEN}"}`));
    assert.match(h["x-idf-signature"]!, /^sha256=[0-9a-f]{64}$/);
  });

  it("lässt fehlende Namen weg und verlangt eine E-Mail", async () => {
    assert.deepEqual(await fetchPrefill(TOKEN, env, recorder(200, { vorname: null, nachname: null, email: "x@example.test" }).fn), {
      email: "x@example.test",
    });
    assert.deepEqual(await fetchPrefill(TOKEN, env, recorder(200, { vorname: "Erika", nachname: "Muster", email: null }).fn), {});
    assert.deepEqual(await fetchPrefill(TOKEN, env, recorder(200, null).fn), {});
  });

  it("füllt bei 404 und anderen Fehlern nichts vor", async () => {
    assert.deepEqual(await fetchPrefill(TOKEN, env, recorder(404, { fehler: "unbekannt" }).fn), {});
    assert.deepEqual(await fetchPrefill(TOKEN, env, recorder(500, {}).fn), {});
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    assert.deepEqual(await fetchPrefill(TOKEN, env, broken), {});
    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    assert.deepEqual(await fetchPrefill(TOKEN, env, notJson), {});
  });

  it("bricht nach 2 Sekunden ab", async () => {
    assert.equal(PREFILL_TIMEOUT_MS, 2000);
    // Antwortet nie; endet erst über das Abbruchsignal der Anfrage.
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    assert.deepEqual(await fetchPrefill(TOKEN, env, hanging), {});
    const took = Date.now() - started;
    assert.ok(took >= 1900 && took < 4000, `Dauer ${took} ms`);
  });

  it("ignoriert Token in falschem Format ohne Anfrage", async () => {
    const { calls, fn } = recorder(200, { vorname: "Erika", nachname: "Muster", email: "erika@example.test" });
    for (const bad of [undefined, "", "kurz", TOKEN + "x", TOKEN.slice(1) + "=", TOKEN.slice(1) + "+", [TOKEN, TOKEN]]) {
      assert.deepEqual(await fetchPrefill(bad, env, fn), {});
    }
    assert.equal(calls.length, 0);
  });

  it("füllt ohne Adresse oder Geheimnis nichts vor", async () => {
    const { calls, fn } = recorder(200, { vorname: "Erika", nachname: "Muster", email: "erika@example.test" });
    assert.deepEqual(await fetchPrefill(TOKEN, {}, fn), {});
    assert.deepEqual(await fetchPrefill(TOKEN, { LERNPLATTFORM_URL: env.LERNPLATTFORM_URL }, fn), {});
    assert.deepEqual(await fetchPrefill(TOKEN, { LERNPLATTFORM_SIGNATUR_GEHEIMNIS: "test-geheimnis" }, fn), {});
    assert.deepEqual(await fetchPrefill(TOKEN, { LERNPLATTFORM_URL: " ", LERNPLATTFORM_SIGNATUR_GEHEIMNIS: "test-geheimnis" }, fn), {});
    assert.equal(calls.length, 0);
  });
});
