import { hit } from "@idf/db/throttle";
import type pg from "pg";
import { keyHash, verifySolution } from "./pow";

/**
 * Schutz der Kaufseiten gegen Kartentests und Massenbestellungen:
 *  1. gelöste Rechenaufgabe (jede gilt nur einmal),
 *  2. höchstens BESTELLUNGEN_JE_IP Bestellversuche je IP-Adresse und Stunde,
 *  3. höchstens BESTELLUNGEN_JE_EMAIL Bestellversuche je E-Mail-Adresse und Stunde.
 * Gutscheinprüfungen sind je IP-Adresse und Stunde begrenzt (GUTSCHEINE_JE_IP).
 */

export const BESTELLUNGEN_JE_IP = 10;
export const BESTELLUNGEN_JE_EMAIL = 5;
export const GUTSCHEINE_JE_IP = 30;

const TOO_MANY = "Zu viele Bestellversuche. Bitte versuche es in einer Stunde noch einmal oder schreib uns an service@investieredichfrei.de.";

/**
 * IP-Adresse der Kundin. Caddy setzt X-Forwarded-For selbst (fremde Werte verwirft es), der letzte
 * Eintrag ist deshalb immer die Adresse, die Caddy gesehen hat.
 */
export function clientIp(forwardedFor: string | null): string {
  const parts = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? "unbekannt";
}

export type GuardResult = { ok: true } | { ok: false; message: string };

export async function guardOrder(
  db: pg.Pool | pg.ClientBase,
  input: { challenge: string; nonce: string; ip: string; email: string },
  now = Date.now(),
): Promise<GuardResult> {
  const pow = verifySolution(input.challenge, input.nonce, now);
  if (!pow.ok) {
    return {
      ok: false,
      message:
        pow.reason === "abgelaufen"
          ? "Die Seite war zu lange offen. Bitte lade sie neu und bestelle noch einmal."
          : "Die Sicherheitsprüfung im Browser ist nicht abgeschlossen. Bitte warte einen Moment und bestelle noch einmal.",
    };
  }
  if ((await hit(db, "rechenaufgabe", keyHash(`pow:${input.challenge}`))) > 1) {
    return { ok: false, message: "Bitte bestelle noch einmal." };
  }
  if ((await hit(db, "bestellung_ip", keyHash(`ip:${input.ip}`))) > BESTELLUNGEN_JE_IP) return { ok: false, message: TOO_MANY };
  if ((await hit(db, "bestellung_email", keyHash(`email:${input.email.trim().toLowerCase()}`))) > BESTELLUNGEN_JE_EMAIL) {
    return { ok: false, message: TOO_MANY };
  }
  return { ok: true };
}

export async function guardCouponCheck(db: pg.Pool | pg.ClientBase, ip: string): Promise<boolean> {
  return (await hit(db, "gutschein_ip", keyHash(`ip:${ip}`))) <= GUTSCHEINE_JE_IP;
}
