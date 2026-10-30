"use server";

import { NoticeError, submitNotice, type NoticeInput } from "@idf/db/notices";
import { transaction } from "./db";
import { todayBerlin } from "./format";
import { parseNoticeForm, type NoticeErrors } from "./notice-form";

export interface NoticeState {
  errors: NoticeErrors;
  message: string | null;
  values: Record<string, string>;
  /** Nach dem Absenden: Eingangsbestätigung zum Anzeigen und Speichern. */
  confirmation: { subject: string; body: string } | null;
}

const KEPT = ["full_name", "email", "contract_reference", "cancellation_type", "reason", "end", "end_date", "message"];

async function submit(kind: NoticeInput["kind"], form: FormData): Promise<NoticeState> {
  const values = Object.fromEntries(KEPT.map((k) => [k, String(form.get(k) ?? "")]));
  const parsed = parseNoticeForm(kind, form, todayBerlin());
  if (!parsed.ok) return { errors: parsed.errors, message: "Bitte prüfe die markierten Angaben.", values, confirmation: null };
  try {
    const r = await transaction("system:website", (c) => submitNotice(c, parsed.value));
    return { errors: {}, message: null, values, confirmation: r.confirmation };
  } catch (err) {
    if (err instanceof NoticeError) return { errors: {}, message: "Bitte prüfe deine Angaben.", values, confirmation: null };
    console.error("Erklärung konnte nicht gespeichert werden", (err as Error).message);
    return {
      errors: {},
      message: "Das hat leider nicht geklappt. Bitte versuche es noch einmal oder schreib uns eine E-Mail.",
      values,
      confirmation: null,
    };
  }
}

export async function submitCancellation(_prev: NoticeState, form: FormData): Promise<NoticeState> {
  return submit("kuendigung", form);
}

export async function submitWithdrawal(_prev: NoticeState, form: FormData): Promise<NoticeState> {
  return submit("widerruf", form);
}
