"use server";

import { EU_STANDARD_RATES_BP } from "@idf/core/tax";
import {
  cancelManualOrder,
  createManualOrder,
  ManualOrderError,
  recordManualPayment,
  recordManualRefund,
} from "@idf/db/manual-orders";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, transaction } from "../../../lib/db";
import { todayBerlin } from "../../../lib/format";
import { manualOrderFromForm } from "../../../lib/manual-order-form";
import { requireUser } from "../../../lib/session";
import { checkVatId, splitVatId } from "../../../lib/vies";
import type { FormState } from "../produkte/actions";

export interface ManualFormState extends FormState {
  /** Eingaben zurück an das Formular, damit nach einem Fehler nichts verloren geht. */
  values?: Record<string, string>;
}

function failure(err: unknown, what: string): FormState {
  if (err instanceof ManualOrderError) return { message: err.message };
  console.error(`${what} fehlgeschlagen`, (err as Error).message);
  return { message: `${what} nicht möglich. Bitte später erneut versuchen.` };
}

export async function createManualOrderAction(_prev: ManualFormState, form: FormData): Promise<ManualFormState> {
  const user = await requireUser();
  const values: Record<string, string> = {};
  for (const [k, val] of form.entries()) if (typeof val === "string" && !k.startsWith("$")) values[k] = val;
  const fail = (message: string): ManualFormState => ({ message, values });
  let created;
  try {
    const input = manualOrderFromForm(form, todayBerlin());
    // Reverse Charge nur mit USt-IdNr., die VIES als gültig bestätigt (Unternehmen im EU-Ausland).
    const c = input.customer;
    let vies: Awaited<ReturnType<typeof checkVatId>> | null = null;
    if (c.kind === "unternehmen" && c.vat_id && c.country in EU_STANDARD_RATES_BP) {
      const company = (
        await pool().query<{ country: string; vat_id: string | null }>(
          `select co.country, co.vat_id from app.products p join app.companies co on co.id = p.company_id where p.id = $1`,
          [input.productId],
        )
      ).rows[0];
      if (company && c.country !== company.country) {
        const expected = c.country === "GR" ? "EL" : c.country;
        if (splitVatId(c.vat_id).countryCode !== expected) return fail("Die USt-IdNr. passt nicht zum gewählten Land.");
        vies = await checkVatId(c.vat_id, company.vat_id);
        if (vies.valid === false) return fail("Diese USt-IdNr. ist laut EU-Prüfung (VIES) nicht gültig. Ohne USt-IdNr. wird Umsatzsteuer berechnet.");
      }
    }
    created = await transaction(`user:${user.id}`, async (tx) => {
      const r = await createManualOrder(tx, user, { ...input, vatIdVerified: vies?.valid === true });
      if (vies) {
        await tx.query(
          `insert into app.vat_id_checks (order_id, country_code, vat_number, valid, consultation_number, registered_name, registered_address, response)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [r.orderId, vies.countryCode, vies.vatNumber, vies.valid, vies.consultationNumber, vies.name, vies.address, JSON.stringify(vies.response)],
        );
      }
      return r;
    });
  } catch (err) {
    return fail(failure(err, "Anlegen").message ?? "");
  }
  revalidatePath("/admin/manuell");
  redirect(`/admin/manuell/${created.orderId}?neu=1`);
}

export async function recordManualPaymentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("order_id") ?? "");
  try {
    await transaction(`user:${user.id}`, (c) =>
      recordManualPayment(c, user, orderId, String(form.get("installment_id") ?? ""), String(form.get("paid_on") ?? ""), String(form.get("reference") ?? "")),
    );
  } catch (err) {
    return failure(err, "Verbuchen");
  }
  revalidatePath(`/admin/manuell/${orderId}`);
  return { ok: true, message: "Zahlung verbucht." };
}

export async function cancelManualOrderAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("order_id") ?? "");
  let r;
  try {
    r = await transaction(`user:${user.id}`, (c) =>
      cancelManualOrder(c, user, orderId, String(form.get("reason") ?? ""), form.get("notify") === "on"),
    );
  } catch (err) {
    return failure(err, "Stornieren");
  }
  revalidatePath(`/admin/manuell/${orderId}`);
  return {
    ok: true,
    message: `Storniert. Stornorechnung ${r.stornoNumber} ist erstellt.${r.refundDueCents > 0 ? " Bitte das Geld zurücküberweisen und unten als Rückzahlung verbuchen." : ""}`,
  };
}

export async function recordManualRefundAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const orderId = String(form.get("order_id") ?? "");
  try {
    await transaction(`user:${user.id}`, (c) =>
      recordManualRefund(c, user, orderId, String(form.get("refunded_on") ?? ""), String(form.get("reference") ?? "")),
    );
  } catch (err) {
    return failure(err, "Verbuchen");
  }
  revalidatePath(`/admin/manuell/${orderId}`);
  return { ok: true, message: "Rückzahlung verbucht." };
}
