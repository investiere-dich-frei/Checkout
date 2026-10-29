import type { CustomerInput } from "@idf/db/orders";
import { COUNTRY_CODES } from "./countries";

export interface CheckoutForm {
  customer: CustomerInput;
  acceptedTerms: boolean;
  withdrawalWaiver: boolean;
}

export type FieldErrors = Partial<Record<string, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Prüft die Eingaben des Checkouts. Fehlermeldungen sind für die Kundin geschrieben. */
export function parseCheckoutForm(form: FormData): { ok: true; value: CheckoutForm } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const kind = text(form, "kind") === "unternehmen" ? "unternehmen" : "privat";
  const first = text(form, "first_name");
  const last = text(form, "last_name");
  const company = text(form, "company_name");
  const email = text(form, "email");
  const street = text(form, "street");
  const postal = text(form, "postal_code");
  const city = text(form, "city");
  const country = text(form, "country").toUpperCase();
  const vatId = text(form, "vat_id").replace(/\s+/g, "").toUpperCase();

  if (!first) errors.first_name = "Bitte gib deinen Vornamen an.";
  if (!last) errors.last_name = "Bitte gib deinen Nachnamen an.";
  if (kind === "unternehmen" && !company) errors.company_name = "Bitte gib den Namen deines Unternehmens an.";
  if (!EMAIL.test(email)) errors.email = "Bitte gib eine gültige E-Mail-Adresse an.";
  if (!street) errors.street = "Bitte gib Straße und Hausnummer an.";
  if (!postal) errors.postal_code = "Bitte gib deine Postleitzahl an.";
  if (!city) errors.city = "Bitte gib deinen Ort an.";
  if (!COUNTRY_CODES.has(country)) errors.country = "Bitte wähle dein Land.";
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId)) errors.vat_id = "Diese USt-IdNr. hat kein gültiges Format.";
  if (form.get("terms") !== "on") errors.terms = "Bitte stimme den AGB zu und bestätige die Datenschutzhinweise.";
  if (form.get("waiver") !== "on") {
    errors.waiver = "Damit du sofort starten kannst, brauchen wir deine Zustimmung zum vorzeitigen Beginn.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      customer: {
        kind,
        first_name: first,
        last_name: last,
        company_name: kind === "unternehmen" ? company : null,
        email,
        street,
        postal_code: postal,
        city,
        country,
        vat_id: kind === "unternehmen" && vatId ? vatId : null,
      },
      acceptedTerms: true,
      withdrawalWaiver: true,
    },
  };
}
