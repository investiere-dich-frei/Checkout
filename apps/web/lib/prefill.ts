import { sign } from "@idf/db/webhooks";

/**
 * Vorausfüllen der Kaufseite für Mitglieder aus der Lernplattform.
 *
 * Die Lernplattform hängt `vf=<Token>` an den Kauflink; Personendaten stehen nie in
 * der Adresse. Die Kaufseite tauscht den Token serverseitig gegen Vorname, Nachname
 * und E-Mail (signierte Anfrage wie bei den ausgehenden Webhooks). Jeder Fehler
 * führt nur dazu, dass nichts vorausgefüllt wird: Der Kauf geht immer weiter.
 * Token und Werte werden nie geloggt.
 */

/** Feldnamen wie im Bestellformular (CheckoutForm). */
export type PrefillValues = Partial<Record<"first_name" | "last_name" | "email", string>>;

/** 43 Zeichen base64url (32 zufällige Bytes), einmalig, 30 Minuten gültig. */
export const PREFILL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const PREFILL_TIMEOUT_MS = 2000;

const MAX_LENGTH = 200;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v && v.length <= MAX_LENGTH ? v : undefined;
}

export async function fetchPrefill(
  token: unknown,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<PrefillValues> {
  if (typeof token !== "string" || !PREFILL_TOKEN.test(token)) return {};
  const base = env.LERNPLATTFORM_URL?.trim();
  const secret = env.LERNPLATTFORM_SIGNATUR_GEHEIMNIS;
  if (!base || !secret) return {};
  try {
    const body = JSON.stringify({ token });
    const timestamp = Math.floor(now() / 1000);
    const res = await fetchFn(`${base.replace(/\/+$/, "")}/api/v1/kasse/vorausfuellen`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idf-timestamp": String(timestamp),
        "x-idf-signature": sign(secret, timestamp, body),
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(PREFILL_TIMEOUT_MS),
    });
    if (res.status !== 200) return {};
    const data = (await res.json()) as { vorname?: unknown; nachname?: unknown; email?: unknown } | null;
    const email = clean(data?.email);
    if (!email || !email.includes("@")) return {};
    const values: PrefillValues = { email };
    const firstName = clean(data?.vorname);
    const lastName = clean(data?.nachname);
    if (firstName) values.first_name = firstName;
    if (lastName) values.last_name = lastName;
    return values;
  } catch {
    // Bewusst ohne Einzelheiten: Fehlermeldungen könnten Teile der Anfrage enthalten.
    console.error("Kaufseite: Vorausfüllen aus der Lernplattform nicht möglich");
    return {};
  }
}
