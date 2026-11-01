import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";
import { clientIp } from "../lib/order-guard";
import { createChallenge, keyHash, leadingZeroBits, solve, verifySolution } from "../lib/pow";
import { solveInBrowser } from "../lib/pow-client";

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 8);
const BITS = 10; // klein, damit der Test schnell bleibt

describe("Rechenaufgabe auf der Kaufseite", () => {
  it("zählt führende Null-Bits", () => {
    assert.equal(leadingZeroBits(new Uint8Array([0, 0, 0x80])), 16);
    assert.equal(leadingZeroBits(new Uint8Array([0, 0x01])), 15);
    assert.equal(leadingZeroBits(new Uint8Array([0xff])), 0);
  });

  it("nimmt eine richtige Lösung an", () => {
    const now = 1_800_000_000_000;
    const c = createChallenge(now, key);
    assert.deepEqual(verifySolution(c, solve(c, BITS), now + 1000, key, BITS), { ok: true });
  });

  it("lehnt fehlende, gefälschte, alte und falsche Lösungen ab", () => {
    const now = 1_800_000_000_000;
    const c = createChallenge(now, key);
    const n = solve(c, BITS);
    assert.deepEqual(verifySolution(c, "", now, key, BITS), { ok: false, reason: "fehlt" });
    assert.deepEqual(verifySolution(c, "x1", now, key, BITS), { ok: false, reason: "ungueltig" });
    assert.deepEqual(verifySolution(c, n, now, otherKey, BITS), { ok: false, reason: "ungueltig" });
    const [, rnd, sig] = c.split(".");
    assert.deepEqual(verifySolution(`${now + 5}.${rnd}.${sig}`, n, now, key, BITS), { ok: false, reason: "ungueltig" });
    assert.deepEqual(verifySolution(c, n, now + 2 * 60 * 60 * 1000, key, BITS), { ok: false, reason: "abgelaufen" });
    assert.deepEqual(verifySolution(c, n, now - 1000, key, BITS), { ok: false, reason: "abgelaufen" });
    // Eine Zahl, die nicht reicht.
    let wrong = 0;
    while (verifySolution(c, String(wrong), now, key, BITS).ok) wrong++;
    assert.deepEqual(verifySolution(c, String(wrong), now, key, BITS), { ok: false, reason: "zu_leicht" });
  });

  it("der Browser findet dieselbe Art Lösung wie der Server", async () => {
    if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const now = Date.now();
    const c = createChallenge(now, key);
    const n = await solveInBrowser(c, BITS, { cancelled: false });
    assert.ok(n !== null);
    assert.deepEqual(verifySolution(c, n, now, key, BITS), { ok: true });
    assert.equal(await solveInBrowser(c, BITS, { cancelled: true }), null);
  });

  it("speichert statt Adressen nur Schlüsselwerte und nimmt die von Caddy gesetzte IP", () => {
    assert.equal(keyHash("ip:192.0.2.1", key).length, 32);
    assert.notDeepEqual(keyHash("ip:192.0.2.1", key), keyHash("ip:192.0.2.1", otherKey));
    assert.equal(clientIp("198.51.100.7, 192.0.2.1"), "192.0.2.1");
    assert.equal(clientIp("192.0.2.1"), "192.0.2.1");
    assert.equal(clientIp(null), "unbekannt");
  });
});
