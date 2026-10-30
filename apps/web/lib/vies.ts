/**
 * USt-IdNr. beim VIES-System der EU prüfen. Mit der eigenen USt-IdNr. als Anfragende
 * liefert VIES eine Abfragenummer, die als Nachweis für Reverse Charge dient.
 */

export interface ViesResult {
  countryCode: string;
  vatNumber: string;
  /** null: VIES nicht erreichbar oder Mitgliedstaat gerade nicht verfügbar. */
  valid: boolean | null;
  consultationNumber: string | null;
  name: string | null;
  address: string | null;
  response: unknown;
}

const URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

/** Griechenland heißt im VIES „EL“, nicht „GR“. */
export function splitVatId(vatId: string): { countryCode: string; vatNumber: string } {
  const v = vatId.replace(/[\s.-]/g, "").toUpperCase();
  const cc = v.slice(0, 2);
  return { countryCode: cc === "GR" ? "EL" : cc, vatNumber: v.slice(2) };
}

export async function checkVatId(vatId: string, requesterVatId: string | null, fetchFn: typeof fetch = fetch): Promise<ViesResult> {
  const { countryCode, vatNumber } = splitVatId(vatId);
  const requester = requesterVatId ? splitVatId(requesterVatId) : null;
  const base = { countryCode, vatNumber, consultationNumber: null, name: null, address: null };
  try {
    const res = await fetchFn(URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        countryCode,
        vatNumber,
        ...(requester ? { requesterMemberStateCode: requester.countryCode, requesterNumber: requester.vatNumber } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as {
      valid?: boolean;
      requestIdentifier?: string;
      name?: string;
      address?: string;
      userError?: string;
    } | null;
    if (!res.ok || !body || typeof body.valid !== "boolean" || (body.userError && body.userError !== "VALID" && body.userError !== "INVALID")) {
      return { ...base, valid: null, response: body };
    }
    const clean = (s?: string) => (s && s.trim() && s.trim() !== "---" ? s.trim() : null);
    return {
      ...base,
      valid: body.valid,
      consultationNumber: clean(body.requestIdentifier),
      name: clean(body.name),
      address: clean(body.address),
      response: body,
    };
  } catch {
    return { ...base, valid: null, response: null };
  }
}
