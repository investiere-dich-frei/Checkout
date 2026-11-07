"use server";

import { canChange } from "@idf/db/admin";
import { addLegalVersion, SettingsError, updateCompanySettings } from "@idf/db/settings";
import { revalidatePath } from "next/cache";
import { transaction } from "../../../lib/db";
import { todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import type { FormState } from "../produkte/actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function updateCompanyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  try {
    await transaction(`user:${user.id}`, (c) =>
      updateCompanySettings(c, text(form, "company_id"), {
        legalName: text(form, "legal_name"),
        street: text(form, "street"),
        postalCode: text(form, "postal_code"),
        city: text(form, "city"),
        country: text(form, "country"),
        vatId: text(form, "vat_id"),
        taxNumber: text(form, "tax_number"),
        registerInfo: text(form, "register_info"),
        bankName: text(form, "bank_name"),
        iban: text(form, "iban"),
        bic: text(form, "bic"),
        chVatRate: text(form, "ch_vat_rate"),
      }),
    );
    revalidatePath("/admin/einstellungen");
    return { ok: true, message: "Gespeichert. Gilt für neue Rechnungen, ausgestellte bleiben unverändert." };
  } catch (err) {
    if (err instanceof SettingsError) return { message: err.message };
    console.error("Firmendaten nicht gespeichert", (err as Error).message);
    return { message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function addLegalVersionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  try {
    await transaction(`user:${user.id}`, (c) =>
      addLegalVersion(c, {
        kind: text(form, "kind"),
        version: text(form, "version"),
        content: text(form, "content"),
        validFromDay: text(form, "valid_from"),
        today: todayBerlin(),
      }),
    );
    revalidatePath("/admin/einstellungen");
    return { ok: true, message: "Neue Fassung gespeichert." };
  } catch (err) {
    if (err instanceof SettingsError) return { message: err.message };
    console.error("Rechtstext nicht gespeichert", (err as Error).message);
    return { message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}
