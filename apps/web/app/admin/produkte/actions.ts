"use server";

import type { AmountBasis } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
import {
  confirmProductTax,
  createPriceOption,
  createProduct,
  ProductError,
  setAccessLike,
  setPriceOptionActive,
  setProductActive,
  updatePriceOption,
  updateProduct,
} from "@idf/db/products";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { transaction } from "../../../lib/db";
import { priceOptionFromForm, productFromForm } from "../../../lib/product-form";
import { requireUser } from "../../../lib/session";

export interface FormState {
  message: string | null;
  ok?: boolean;
}

/** Führt eine Änderung als angemeldete Person aus und macht Fehler lesbar. */
async function run<T>(fn: (user: Awaited<ReturnType<typeof requireUser>>, c: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; message: string }
> {
  const user = await requireUser();
  try {
    return { ok: true, value: await transaction(`user:${user.id}`, (c) => fn(user, c)) };
  } catch (err) {
    if (err instanceof ProductError) return { ok: false, message: err.message };
    console.error("Produktpflege fehlgeschlagen", (err as Error).message);
    return { ok: false, message: "Speichern nicht möglich. Bitte später erneut versuchen." };
  }
}

const id = (form: FormData, key: string) => String(form.get(key) ?? "");
/** Kurszuordnung aus dem Formular; undefined, wenn das Feld nicht angezeigt wurde. */
const accessLike = (form: FormData) => (form.has("access_like_product_id") ? id(form, "access_like_product_id") || null : undefined);

export async function createProductAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async (user, c) => {
    const productId = await createProduct(c, user, id(form, "company_id") || null, productFromForm(form));
    const like = accessLike(form);
    if (like) await setAccessLike(c, user, productId, like);
    return productId;
  });
  if (!r.ok) return { message: r.message };
  revalidatePath("/admin/produkte");
  redirect(`/admin/produkte/${r.value}?neu=1`);
}

export async function updateProductAction(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = id(form, "product_id");
  const r = await run(async (user, c) => {
    const result = await updateProduct(c, user, productId, productFromForm(form));
    const like = accessLike(form);
    if (like !== undefined) await setAccessLike(c, user, productId, like);
    return result;
  });
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${productId}`);
  return {
    ok: true,
    message: r.value.taxReset
      ? "Gespeichert. Die Steuerart hat sich geändert: Das Produkt ist jetzt abgeschaltet. Bitte unten die Steuer bestätigen und wieder freischalten."
      : "Gespeichert.",
  };
}

export async function confirmTaxAction(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = id(form, "product_id");
  if (form.get("confirm") !== "on") return { message: "Bitte das Häkchen setzen, um die Steuer zu bestätigen." };
  const basisByOption: Record<string, AmountBasis> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("basis_")) basisByOption[k.slice(6)] = String(v) as AmountBasis;
  }
  const r = await run((user, c) =>
    confirmProductTax(c, user, productId, { taxCategory: id(form, "tax_category") as TaxCategory, basisByOption }),
  );
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${productId}`);
  return { ok: true, message: "Steuer bestätigt." };
}

export async function setProductActiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = id(form, "product_id");
  const active = form.get("active") === "1";
  const r = await run((user, c) => setProductActive(c, user, productId, active));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${productId}`);
  revalidatePath("/admin/produkte");
  return { ok: true, message: active ? "Freigeschaltet. Die Kauflinks funktionieren jetzt." : "Abgeschaltet. Die Kauflinks zeigen jetzt „nicht verfügbar“." };
}

export async function createPriceOptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = id(form, "product_id");
  const r = await run((user, c) => createPriceOption(c, user, productId, priceOptionFromForm(form)));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${productId}`);
  redirect(`/admin/produkte/${productId}?option=neu#steuer`);
}

export async function updatePriceOptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const optionId = id(form, "option_id");
  const r = await run((user, c) => updatePriceOption(c, user, optionId, priceOptionFromForm(form)));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${r.value}`);
  redirect(`/admin/produkte/${r.value}?option=geaendert#steuer`);
}

export async function setPriceOptionActiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const optionId = id(form, "option_id");
  const active = form.get("active") === "1";
  const r = await run((user, c) => setPriceOptionActive(c, user, optionId, active));
  if (!r.ok) return { message: r.message };
  revalidatePath(`/admin/produkte/${r.value}`);
  return { ok: true, message: null };
}
