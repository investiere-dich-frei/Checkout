import type { ManualPaymentModel } from "@idf/core/manual-plan";
import { ManualOrderError, type ManualOrderInput } from "@idf/db/manual-orders";
import { ProductError } from "@idf/db/products";
import { COUNTRY_CODES } from "./countries";
import { parseEuro } from "./product-form";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MODELS: ManualPaymentModel[] = ["einmal", "anzahlung_rest", "anzahlung_raten", "raten"];

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function euro(form: FormData, key: string, what: string): number | null {
  try {
    return parseEuro(form.get(key));
  } catch (err) {
    if (err instanceof ProductError) throw new ManualOrderError(`${what}: ${err.message}`);
    throw err;
  }
}

/**
 * Liest das Formular „Neue manuelle Bestellung“. Wirft ManualOrderError mit einer Meldung
 * für die Vertriebsperson. Steuer, Vertriebsperson und Rechte prüft danach die Datenbankschicht.
 */
export function manualOrderFromForm(form: FormData, issueDay: string): Omit<ManualOrderInput, "vatIdVerified"> {
  const kind = text(form, "kind") === "unternehmen" ? "unternehmen" : "privat";
  const country = text(form, "country").toUpperCase();
  const email = text(form, "email");
  const missing: string[] = [];
  const need = (key: string, label: string) => {
    const v = text(form, key);
    if (!v) missing.push(label);
    return v;
  };
  const productId = need("product_id", "Produkt");
  const first = need("first_name", "Vorname");
  const last = need("last_name", "Nachname");
  const company = kind === "unternehmen" ? need("company_name", "Firma") : "";
  const street = need("street", "Straße");
  const postal = need("postal_code", "PLZ");
  const city = need("city", "Ort");
  if (missing.length) throw new ManualOrderError(`Bitte ausfüllen: ${missing.join(", ")}.`);
  if (!EMAIL.test(email)) throw new ManualOrderError("Die E-Mail-Adresse ist nicht gültig.");
  if (!COUNTRY_CODES.has(country)) throw new ManualOrderError("Bitte das Land wählen.");
  const vatId = text(form, "vat_id").replace(/\s+/g, "").toUpperCase();
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId)) throw new ManualOrderError("Die USt-IdNr. hat kein gültiges Format.");

  const model = text(form, "payment_model") as ManualPaymentModel;
  if (!MODELS.includes(model)) throw new ManualOrderError("Bitte das Zahlungsmodell wählen.");
  const total = euro(form, "total", "Gesamtbetrag");
  if (total === null) throw new ManualOrderError("Bitte den Gesamtbetrag eintragen.");
  const termRaw = text(form, "payment_term_days") || "14";
  if (!/^\d+$/.test(termRaw)) throw new ManualOrderError("Das Zahlungsziel bitte in ganzen Tagen angeben.");
  const countRaw = text(form, "installment_count");
  if (countRaw && !/^\d+$/.test(countRaw)) throw new ManualOrderError("Die Anzahl der Raten bitte als ganze Zahl angeben.");
  const next = text(form, "next_due_date");
  if (next && !DAY.test(next)) throw new ManualOrderError("Die nächste Fälligkeit ist kein gültiges Datum.");

  const paidOn = form.get("already_paid") === "on" ? text(form, "paid_on") : "";
  if (form.get("already_paid") === "on" && !DAY.test(paidOn)) throw new ManualOrderError("Bitte das Datum des Zahlungseingangs angeben.");

  return {
    productId,
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
    sellerUserId: text(form, "seller_user_id") || null,
    plan: {
      model,
      totalCents: total,
      firstCents: model === "einmal" ? null : euro(form, "first", "Erste Zahlung"),
      installmentCount: countRaw ? Number(countRaw) : null,
      nextDueDate: next || null,
      paymentTermDays: Number(termRaw),
    },
    issueDay,
    alreadyPaid: paidOn ? { paidOn, reference: text(form, "paid_reference") } : null,
    sendMail: form.get("send_mail") === "on",
    internalNote: text(form, "internal_note") || null,
  };
}
