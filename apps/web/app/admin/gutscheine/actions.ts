"use server";

import { CouponError, createCoupon, setCouponActive, updateCoupon } from "@idf/db/coupons";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { couponFromForm } from "../../../lib/coupon-form";
import { transaction } from "../../../lib/db";
import { requireUser } from "../../../lib/session";
import type { FormState } from "../produkte/actions";

async function run<T>(fn: (user: Awaited<ReturnType<typeof requireUser>>, c: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; message: string }
> {
  const user = await requireUser();
  try {
    return { ok: true, value: await transaction(`user:${user.id}`, (c) => fn(user, c)) };
  } catch (err) {
    if (err instanceof CouponError) return { ok: false, message: err.message };
    console.error("Gutscheinpflege fehlgeschlagen", (err as Error).message);
    return { ok: false, message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function createCouponAction(_prev: FormState, form: FormData): Promise<FormState> {
  let input;
  try {
    input = couponFromForm(form);
  } catch (err) {
    if (err instanceof CouponError) return { message: err.message };
    throw err;
  }
  const r = await run((user, c) => createCoupon(c, user, null, input));
  if (!r.ok) return { message: r.message };
  revalidatePath("/admin/gutscheine");
  redirect(`/admin/gutscheine/${r.value}?neu=1`);
}

export async function updateCouponAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("coupon_id") ?? "");
  let input;
  try {
    input = couponFromForm(form);
  } catch (err) {
    if (err instanceof CouponError) return { message: err.message };
    throw err;
  }
  const r = await run((user, c) => updateCoupon(c, user, id, input));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/gutscheine/${id}`);
  revalidatePath("/admin/gutscheine");
  return { ok: true, message: "Gespeichert." };
}

export async function setCouponActiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("coupon_id") ?? "");
  const active = form.get("active") === "1";
  const r = await run((user, c) => setCouponActive(c, user, id, active));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/gutscheine/${id}`);
  revalidatePath("/admin/gutscheine");
  return { ok: true, message: active ? "Gutschein ist eingeschaltet." : "Gutschein ist abgeschaltet." };
}
