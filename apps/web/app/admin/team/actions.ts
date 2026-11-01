"use server";

import { createTeamMember, TeamError, updateTeamMember } from "@idf/db/team";
import { revalidatePath } from "next/cache";
import { transaction } from "../../../lib/db";
import { requireUser } from "../../../lib/session";
import { portalBaseUrl } from "../../konto/actions";
import type { FormState } from "../produkte/actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function run(fn: (actor: string) => Promise<string>): Promise<FormState> {
  const user = await requireUser();
  if (user.role !== "admin") return { message: "Keine Berechtigung." };
  try {
    const message = await fn(`user:${user.id}`);
    revalidatePath("/admin/team");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof TeamError) return { message: err.message };
    console.error("Team nicht gespeichert", (err as Error).message);
    return { message: "Nicht gespeichert. Bitte später erneut versuchen." };
  }
}

export async function createTeamMemberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const base = await portalBaseUrl();
  return run(async (actor) => {
    await transaction(actor, (c) =>
      createTeamMember(c, user, { email: text(form, "email"), displayName: text(form, "display_name"), role: text(form, "role"), salesCode: text(form, "sales_code") }, base),
    );
    return "Angelegt. Ein Anmeldelink ist per E-Mail unterwegs (15 Minuten gültig, danach auf der Anmeldeseite neu anfordern).";
  });
}

export async function updateTeamMemberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async (actor) => {
    const changed = await transaction(actor, (c) =>
      updateTeamMember(c, user, text(form, "user_id"), {
        displayName: text(form, "display_name"),
        role: text(form, "role"),
        salesCode: text(form, "sales_code"),
        active: form.get("active") === "on",
      }),
    );
    return changed ? "Gespeichert." : "Keine Änderung.";
  });
}
