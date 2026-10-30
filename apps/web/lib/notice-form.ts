import type { NoticeInput } from "@idf/db/notices";

export type NoticeErrors = Record<string, string>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Formular für Kündigung oder Widerruf prüfen. Gibt Fehler je Feld zurück. */
export function parseNoticeForm(
  kind: NoticeInput["kind"],
  form: FormData,
  today: string,
): { ok: true; value: NoticeInput } | { ok: false; errors: NoticeErrors } {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const errors: NoticeErrors = {};
  const fullName = get("full_name");
  const email = get("email");
  const contractReference = get("contract_reference");
  if (!fullName) errors.full_name = "Bitte gib deinen Namen an.";
  if (!EMAIL.test(email)) errors.email = "Bitte gib eine gültige E-Mail-Adresse an.";
  if (!contractReference) errors.contract_reference = "Bitte gib an, welchen Vertrag du meinst.";

  if (kind === "widerruf") {
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { kind, fullName, email, contractReference, message: get("message") || null } };
  }

  const type = get("cancellation_type") === "ausserordentlich" ? "ausserordentlich" : "ordentlich";
  const reason = get("reason");
  if (type === "ausserordentlich" && !reason) errors.reason = "Bitte nenne den Grund für die außerordentliche Kündigung.";
  let requestedEnd: string | null = null;
  if (get("end") === "datum") {
    requestedEnd = get("end_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedEnd)) errors.end_date = "Bitte wähle ein Datum.";
    else if (requestedEnd < today) errors.end_date = "Das Datum liegt in der Vergangenheit.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { kind, fullName, email, contractReference, cancellationType: type, reason: reason || null, requestedEnd, message: get("message") || null },
  };
}
