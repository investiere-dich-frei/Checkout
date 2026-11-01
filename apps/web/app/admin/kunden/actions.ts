"use server";

import { canChange } from "@idf/db/admin";
import { PauseError, pauseSubscription, resumeSubscription } from "@idf/db/billing";
import { resendInvoiceMail } from "@idf/db/customer-mails";
import { requestPortalLink } from "@idf/db/customer-portal";
import { CustomerError, updateCustomerContact } from "@idf/db/customers";
import { revalidatePath } from "next/cache";
import { chargeNow } from "../../../lib/charging";
import { pool, transaction } from "../../../lib/db";
import { todayBerlin } from "../../../lib/format";
import { paypal } from "../../../lib/paypal";
import { requireUser } from "../../../lib/session";
import { stripe } from "../../../lib/stripe";
import { portalBaseUrl } from "../../konto/actions";
import type { FormState } from "../produkte/actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function updateCustomerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const id = text(form, "customer_id");
  try {
    const n = await transaction(`user:${user.id}`, (c) =>
      updateCustomerContact(c, user, id, {
        first_name: text(form, "first_name"),
        last_name: text(form, "last_name"),
        company_name: text(form, "company_name"),
        email: text(form, "email"),
        street: text(form, "street"),
        postal_code: text(form, "postal_code"),
        city: text(form, "city"),
      }),
    );
    revalidatePath(`/admin/kunden/${id}`);
    return { ok: true, message: n ? "Gespeichert. Gilt für neue Rechnungen und E-Mails; ausgestellte Rechnungen bleiben unverändert." : "Keine Änderung." };
  } catch (err) {
    if (err instanceof CustomerError) return { message: err.message };
    console.error("Kundendaten nicht gespeichert", (err as Error).message);
    return { message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function resendInvoiceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const invoiceId = text(form, "invoice_id");
  const to = text(form, "to").trim();
  try {
    await transaction(`user:${user.id}`, (c) => resendInvoiceMail(c, invoiceId, to || undefined));
    return { ok: true, message: `Wird in den nächsten Minuten an ${to || "die Adresse auf der Rechnung"} geschickt.` };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("Bitte")) return { message: msg };
    console.error("Rechnung nicht erneut versendet", msg);
    return { message: "Versand nicht möglich. Bitte später erneut versuchen." };
  }
}

const BLOCKED: Record<string, string> = {
  nicht_gefunden: "Die Rate gibt es nicht.",
  nicht_offen: "Die Rate ist nicht mehr offen.",
  noch_nicht_faellig: "Die Rate ist noch nicht fällig.",
  unterwegs: "Ein Einzug läuft bereits. Das Ergebnis kommt in wenigen Minuten.",
  per_rechnung: "Diese Bestellung wird per Überweisung bezahlt.",
  bestellung_beendet: "Die Bestellung ist storniert oder erstattet.",
  keine_zahlungsart: "Es ist keine Zahlungsart gespeichert. Die Kundin muss über die Bestellseite zahlen.",
  paypal_abo: "Dieses Abo bucht PayPal selbst ab. Die Zahlung kommt von PayPal.",
  anbieter_fehlt: "Der Zahlungsanbieter ist auf dem Server nicht eingerichtet.",
};

const OUTCOME: Record<string, string> = {
  eingereicht: "Einzug eingereicht. Die Rechnung kommt, sobald der Anbieter die Zahlung bestätigt.",
  gebucht: "Bezahlt. Die Rechnung ist erstellt und geht per E-Mail raus.",
  abgelehnt: "Abgelehnt. Grund steht unten bei den Einzugsversuchen.",
  fehler: "Der Anbieter hat nicht geantwortet. Bitte später erneut versuchen.",
};

export async function chargeNowAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const orderId = text(form, "order_id");
  try {
    const r = await chargeNow(pool(), { stripe: stripe(), paypal: paypal() }, text(form, "installment_id"), todayBerlin(), `user:${user.id}`);
    revalidatePath(`/admin/bestellungen/${orderId}`);
    if (!r.ok) return { message: BLOCKED[r.reason] ?? "Nicht möglich." };
    return { ok: r.outcome === "gebucht" || r.outcome === "eingereicht", message: OUTCOME[r.outcome]! };
  } catch (err) {
    console.error("Einzug von Hand fehlgeschlagen", (err as Error).message);
    return { message: "Einzug nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function pauseSubscriptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const orderId = text(form, "order_id");
  const startsOn = text(form, "starts_on");
  const endsOn = text(form, "ends_on") || null;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(startsOn) || (endsOn && !day.test(endsOn))) return { message: "Bitte gültige Daten angeben." };
  try {
    const n = await transaction(`user:${user.id}`, (c) =>
      pauseSubscription(c, { orderId, startsOn, endsOn, reason: text(form, "reason"), actor: `user:${user.id}`, today: todayBerlin() }),
    );
    revalidatePath(`/admin/bestellungen/${orderId}`);
    return { ok: true, message: `Pausiert.${n ? ` ${n} Zahlung${n === 1 ? " entfällt" : "en entfallen"}.` : ""}` };
  } catch (err) {
    if (err instanceof PauseError) return { message: err.message };
    console.error("Pause nicht gespeichert", (err as Error).message);
    return { message: "Pausieren nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function resumeSubscriptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const orderId = text(form, "order_id");
  const ok = await transaction(`user:${user.id}`, (c) => resumeSubscription(c, { orderId, actor: `user:${user.id}`, today: todayBerlin() }));
  revalidatePath(`/admin/bestellungen/${orderId}`);
  return ok ? { ok: true, message: "Fortgesetzt. Die nächste Zahlung wird zum Fälligkeitstag eingezogen." } : { message: "Es ist keine Pause offen." };
}

export async function sendPortalLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const email = text(form, "email");
  const base = await portalBaseUrl();
  const ok = await transaction(`user:${user.id}`, (c) => requestPortalLink(c, email, base, `user:${user.id}`));
  return ok ? { ok: true, message: `Link zum Kundenbereich geht in den nächsten Minuten an ${email}.` } : { message: "Zu dieser Adresse gibt es keine Kundin." };
}
