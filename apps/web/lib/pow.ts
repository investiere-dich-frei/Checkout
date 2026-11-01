import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Rechenaufgabe (Proof of Work) gegen automatisierte Bestellungen, ohne fremden Captcha-Dienst und
 * ohne Cookies. Der Server stellt eine signierte Aufgabe; der Browser sucht im Hintergrund eine Zahl,
 * sodass SHA-256(aufgabe + ":" + zahl) mit POW_BITS Null-Bits beginnt. Für eine Kundin dauert das
 * einen Moment, während sie das Formular ausfüllt; für Massenbestellungen wird es teuer.
 */

export const POW_BITS = 17;
export const POW_MAX_AGE_MS = 60 * 60 * 1000;

let cachedKey: Buffer | null = null;
/** Schlüssel für Signaturen und Zähler. Fest über Neustarts, ohne eigene Einstellung nötig. */
export function serverKey(): Buffer {
  if (cachedKey) return cachedKey;
  const base = process.env.CHECKOUT_POW_SECRET || process.env.DATABASE_URL || "";
  if (!base) throw new Error("Weder CHECKOUT_POW_SECRET noch DATABASE_URL gesetzt");
  cachedKey = createHash("sha256").update(`idf-kaufseite:${base}`).digest();
  return cachedKey;
}

/** HMAC eines Werts, z. B. einer IP-Adresse, damit nur der Hash gespeichert wird. */
export function keyHash(value: string, key = serverKey()): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

/** Neue Aufgabe: "zeitstempel.zufall.signatur". */
export function createChallenge(now = Date.now(), key = serverKey()): string {
  const body = `${now}.${randomBytes(12).toString("base64url")}`;
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function leadingZeroBits(hash: Uint8Array): number {
  let n = 0;
  for (const b of hash) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

export type PowCheck = { ok: true } | { ok: false; reason: "fehlt" | "ungueltig" | "abgelaufen" | "zu_leicht" };

/** Lösung prüfen (ohne Wiederverwendungsschutz; den macht der Aufrufer über einen Zähler). */
export function verifySolution(challenge: string, nonce: string, now = Date.now(), key = serverKey(), bits = POW_BITS): PowCheck {
  if (!challenge || !nonce) return { ok: false, reason: "fehlt" };
  const parts = challenge.split(".");
  if (parts.length !== 3 || !/^\d{1,12}$/.test(nonce)) return { ok: false, reason: "ungueltig" };
  const [ts, rnd, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", key).update(`${ts}.${rnd}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "ungueltig" };
  const age = now - Number(ts);
  if (!(age >= 0 && age <= POW_MAX_AGE_MS)) return { ok: false, reason: "abgelaufen" };
  const hash = createHash("sha256").update(`${challenge}:${nonce}`).digest();
  if (leadingZeroBits(hash) < bits) return { ok: false, reason: "zu_leicht" };
  return { ok: true };
}

/** Lösung suchen (für Tests und als Vorlage für den Browser). */
export function solve(challenge: string, bits = POW_BITS): string {
  for (let i = 0; ; i++) {
    if (leadingZeroBits(createHash("sha256").update(`${challenge}:${i}`).digest()) >= bits) return String(i);
  }
}
