"use server";

import { canChange } from "@idf/db/admin";
import { markThrivecartStopped, TakeoverError } from "@idf/db/takeover";
import { revalidatePath } from "next/cache";
import { pool, transaction } from "../../../lib/db";
import { formatDay, todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { stripe } from "../../../lib/stripe";
import { takeOverStripeSubscription } from "../../../lib/takeover";
import type { FormState } from "../produkte/actions";

export async function takeoverAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const api = stripe();
  if (!api) return { message: "Stripe ist auf dem Server nicht eingerichtet." };
  try {
    const r = await takeOverStripeSubscription(pool(), api, user, {
      subscriptionId: String(form.get("subscription_id") ?? ""),
      today: todayBerlin(),
      vatIdVerified: form.get("vat_id_verified") === "on",
    });
    revalidatePath("/admin/abo-umzug");
    return {
      ok: true,
      message: `Übernommen. Erste Zahlung im neuen System am ${formatDay(r.firstDueOn)}; das Stripe-Abo endet davor. Jetzt in Thrivecart die Abrechnung beenden (nicht kündigen) und unten abhaken.`,
    };
  } catch (err) {
    if (err instanceof TakeoverError) return { message: err.message };
    console.error("Abo-Übernahme fehlgeschlagen", (err as Error).message);
    return { message: "Übernahme nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function markStoppedAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const ok = await transaction(`user:${user.id}`, (c) => markThrivecartStopped(c, user, String(form.get("order_id") ?? "")));
  revalidatePath("/admin/abo-umzug");
  return ok ? { ok: true, message: "Festgehalten." } : { message: "War schon festgehalten." };
}
