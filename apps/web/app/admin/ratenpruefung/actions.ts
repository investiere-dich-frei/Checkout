"use server";

import { canChange } from "@idf/db/admin";
import { CreditError, decideCreditCheck, getCreditSettings, updateCreditSettings } from "@idf/db/credit";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { pool, transaction } from "../../../lib/db";
import { requireUser } from "../../../lib/session";
import type { FormState } from "../produkte/actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** „600“ oder „1.250,50“ Euro in Cent; leer = null. */
function euroCents(v: string, label: string): number | null {
  if (!v) return null;
  const s = v.replace(/\s|€/g, "");
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(n)) throw new CreditError(`${label}: bitte als Betrag in Euro angeben.`);
  return Math.round(Number(n) * 100);
}

async function baseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
}

export async function decideCheckAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  const checkId = text(form, "check_id");
  const decision = text(form, "decision");
  if (decision !== "freigegeben" && decision !== "abgelehnt") return { message: "Bitte Freigeben oder Ablehnen wählen." };
  try {
    const r = (
      await pool().query<{ slug: string | null; option: string }>(
        `select p.slug, o.id option from app.credit_checks c join app.price_options o on o.id = c.price_option_id
           join app.products p on p.id = o.product_id where c.id = $1`,
        [checkId],
      )
    ).rows[0];
    if (!r?.slug) return { message: "Zu dieser Prüfung gibt es keine Kaufseite (Produkt ohne Kurzname)." };
    const offerUrl = `${await baseUrl()}/kaufen/${encodeURIComponent(r.slug)}/${r.option}`;
    await transaction(`user:${user.id}`, (c) => decideCreditCheck(c, checkId, decision, text(form, "note"), `user:${user.id}`, offerUrl));
    revalidatePath("/admin/ratenpruefung");
    return { ok: true, message: decision === "freigegeben" ? "Freigegeben. Die Kundin bekommt die Rateninformation mit Link per E-Mail." : "Abgelehnt. Die Kundin bekommt eine E-Mail." };
  } catch (err) {
    if (err instanceof CreditError) return { message: err.message };
    console.error("Entscheidung Ratenprüfung nicht gespeichert", (err as Error).message);
    return { message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function updateCreditSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canChange(user)) return { message: "Keine Berechtigung." };
  try {
    const current = await getCreditSettings(pool());
    const share = text(form, "green_max_share").replace(",", ".");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(share)) throw new CreditError("Anteil für „grün“ bitte als Prozent angeben, z. B. 50.");
    await transaction(`user:${user.id}`, (c) =>
      updateCreditSettings(
        c,
        {
          enabled: form.get("enabled") === "on",
          contactEmail: text(form, "contact_email"),
          contactPhone: text(form, "contact_phone") || null,
          creditCountries: text(form, "credit_countries").split(/[\s,;]+/).filter(Boolean),
          livingCostCents: euroCents(text(form, "living_cost"), "Lebenshaltung") ?? current.livingCostCents,
          livingCostPerDependentCents: euroCents(text(form, "living_cost_dependent"), "Zuschlag je Person") ?? current.livingCostPerDependentCents,
          greenMaxShareBp: Math.round(Number(share) * 100),
          manualReviewFromCents: euroCents(text(form, "manual_review_from"), "Prüfung durch das Team ab"),
          bureauFromCents: euroCents(text(form, "bureau_from"), "Auskunftei ab"),
        },
        `user:${user.id}`,
      ),
    );
    revalidatePath("/admin/ratenpruefung");
    return { ok: true, message: "Gespeichert. Gilt für neue Prüfungen; bisherige behalten ihre Regeln." };
  } catch (err) {
    if (err instanceof CreditError) return { message: err.message };
    console.error("Einstellungen Ratenkauf nicht gespeichert", (err as Error).message);
    return { message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}
