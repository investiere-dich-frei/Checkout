import type { DiscountKind, DiscountScope } from "@idf/core/discount";
import { CouponError, type CouponInput, type CouponRow } from "@idf/db/coupons";
import { ProductError } from "@idf/db/products";
import { formatDay, todayBerlin } from "./format";
import { centsToInput, parseEuro } from "./product-form";

/** Liest Prozent wie getippt: „10“, „12,5“, „12.5 %“. Ergebnis in Basispunkten. */
export function parsePercent(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").replace(/%/g, "").replace(/\s/g, "");
  if (!s) return null;
  const m = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) throw new CouponError(`„${String(raw)}“ ist kein gültiger Prozentsatz. Beispiel: 10 oder 12,5`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function parseCount(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) throw new CouponError("Bitte beim Limit eine ganze Zahl eintragen, oder leer lassen für unbegrenzt.");
  return Number(s);
}

const day = (raw: FormDataEntryValue | null) => String(raw ?? "").trim() || null;

/** Formular der Gutscheinverwaltung → Eingabe für packages/db/src/coupons.ts. */
export function couponFromForm(form: FormData): CouponInput {
  const kind: DiscountKind = form.get("kind") === "betrag" ? "betrag" : "prozent";
  let amountCents: number | null = null;
  if (kind === "betrag") {
    try {
      amountCents = parseEuro(form.get("amount"));
    } catch (err) {
      if (err instanceof ProductError) throw new CouponError(err.message);
      throw err;
    }
  }
  const scope: DiscountScope = form.get("scope") === "alle" ? "alle" : "erste";
  return {
    code: String(form.get("code") ?? ""),
    label: String(form.get("label") ?? ""),
    kind,
    percentBp: kind === "prozent" ? parsePercent(form.get("percent")) : null,
    amountCents,
    scope,
    allProducts: form.get("all_products") === "on",
    productIds: form.getAll("product_ids").map(String),
    validFrom: day(form.get("valid_from")),
    validUntil: day(form.get("valid_until")),
    maxRedemptions: parseCount(form.get("max_redemptions")),
  };
}

/** Prozent in Basispunkten als Text, z. B. 1250 → „12,5“. */
export function percentToInput(bp: number | null): string {
  if (bp === null) return "";
  return (bp / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export function couponValues(c: CouponRow | null) {
  return {
    code: c?.code ?? "",
    label: c?.label ?? "",
    kind: c?.kind ?? "prozent",
    percent: percentToInput(c?.percentBp ?? null),
    amount: centsToInput(c?.amountCents ?? null),
    scope: c?.scope ?? "erste",
    allProducts: c?.allProducts ?? true,
    productIds: c?.productIds ?? [],
    validFrom: c?.validFrom ?? "",
    validUntil: c?.validUntil ?? "",
    maxRedemptions: c?.maxRedemptions === null || c?.maxRedemptions === undefined ? "" : String(c.maxRedemptions),
  };
}
export type CouponValues = ReturnType<typeof couponValues>;

/** Zustand in Worten, wie ihn die Kundin erlebt. */
export function couponStatus(c: CouponRow, today = todayBerlin()): { text: string; ok: boolean } {
  if (!c.active) return { text: "abgeschaltet", ok: false };
  if (c.validFrom && c.validFrom > today) return { text: `ab ${formatDay(c.validFrom)}`, ok: false };
  if (c.validUntil && c.validUntil < today) return { text: "abgelaufen", ok: false };
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return { text: "aufgebraucht", ok: false };
  return { text: "einlösbar", ok: true };
}

