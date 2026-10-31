"use server";

import { canChange } from "@idf/db/admin";
import { PageContentError, savePage } from "@idf/db/checkout-pages";
import { revalidatePath } from "next/cache";
import { transaction } from "../../../lib/db";
import { requireUser } from "../../../lib/session";

export interface SaveState {
  ok: boolean;
  message: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function savePageAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const user = await requireUser();
  if (!canChange(user)) return { ok: false, message: "Nur Admins dürfen Kaufseiten ändern." };
  const target = String(form.get("target") ?? "");
  if (target !== "standard" && !UUID.test(target)) return { ok: false, message: "Unbekannte Seite." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("content") ?? ""));
  } catch {
    return { ok: false, message: "Die Seite konnte nicht gelesen werden. Bitte neu laden." };
  }
  try {
    await transaction(`user:${user.id}`, (c) => savePage(c, target === "standard" ? null : target, raw, user.id));
  } catch (err) {
    if (err instanceof PageContentError) return { ok: false, message: err.message };
    console.error("Kaufseite nicht gespeichert", (err as Error).message);
    return { ok: false, message: "Speichern fehlgeschlagen. Bitte noch einmal versuchen." };
  }
  revalidatePath(`/admin/seiten/${target}`);
  revalidatePath("/admin/seiten");
  return { ok: true, message: `Gespeichert um ${new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr. Die Kaufseite zeigt die Änderung sofort.` };
}
