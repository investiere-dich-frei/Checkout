"use server";

import { EU_STANDARD_RATES_BP } from "@idf/core/tax";
import { findSeller, currentLegalTexts } from "@idf/db/catalog";
import { enqueueOrderConfirmation } from "@idf/db/customer-mails";
import { describeDiscount, type Discount } from "@idf/core/discount";
import { findCoupon } from "@idf/db/coupons";
import { CouponRejected, OrderError, placeOrder } from "@idf/db/orders";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseCheckoutForm, type FieldErrors } from "../../../../lib/checkout-form";
import { pool, transaction } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";
import { clientIp, guardCouponCheck, guardOrder } from "../../../../lib/order-guard";
import { createChallenge } from "../../../../lib/pow";
import { checkVatId, splitVatId, type ViesResult } from "../../../../lib/vies";

export interface CheckoutState {
  errors: FieldErrors;
  message: string | null;
  /** Eingaben zurück an das Formular, damit nach einem Fehler nichts verloren geht. */
  values: Record<string, string>;
  /** Neue Rechenaufgabe für den nächsten Versuch (jede gilt nur einmal). */
  challenge: string;
}

const KEPT_FIELDS = ["first_name", "last_name", "company_name", "email", "street", "postal_code", "city", "vat_id", "coupon"];

export type CouponPreview = { ok: true; code: string; discount: Discount; text: string } | { ok: false; message: string };

/** Gutscheincode auf der Kaufseite prüfen. Bei der Bestellung wird er noch einmal geprüft. */
export async function checkCouponAction(code: string, priceOptionId: string): Promise<CouponPreview> {
  if (!code.trim()) return { ok: false, message: "Bitte einen Gutscheincode eingeben." };
  try {
    if (!(await guardCouponCheck(pool(), clientIp((await headers()).get("x-forwarded-for"))))) {
      return { ok: false, message: "Zu viele Versuche. Bitte versuche es später noch einmal." };
    }
    const r = await findCoupon(pool(), code, priceOptionId);
    if (!r.ok) return r;
    const d = r.coupon.discount;
    const basis = (
      await pool().query<{ amount_basis: "brutto" | "netto" }>(`select amount_basis from app.price_options where id = $1`, [priceOptionId])
    ).rows[0]?.amount_basis;
    const text = `${describeDiscount(d, r.coupon.currency, basis)}${d.scope === "alle" ? " auf jede Zahlung" : " auf die erste Zahlung"}`;
    return { ok: true, code: r.coupon.code, discount: d, text };
  } catch (err) {
    console.error("Gutscheinprüfung fehlgeschlagen", (err as Error).message);
    return { ok: false, message: "Der Gutschein lässt sich gerade nicht prüfen. Bitte versuche es gleich noch einmal." };
  }
}

export async function submitOrder(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  // Bei Erfolg leitet placeFromForm weiter; jede Rückmeldung bekommt eine neue Rechenaufgabe.
  return { ...(await placeFromForm(form)), challenge: createChallenge() };
}

async function placeFromForm(form: FormData): Promise<Omit<CheckoutState, "challenge">> {
  const values = Object.fromEntries(KEPT_FIELDS.map((k) => [k, String(form.get(k) ?? "")]));
  const parsed = parseCheckoutForm(form);
  if (!parsed.ok) return { errors: parsed.errors, message: "Bitte prüfe die markierten Angaben.", values };

  // Schutz gegen Kartentests: Rechenaufgabe und Grenzen je IP- und E-Mail-Adresse.
  const guard = await guardOrder(pool(), {
    challenge: String(form.get("pow_challenge") ?? ""),
    nonce: String(form.get("pow_nonce") ?? ""),
    ip: clientIp((await headers()).get("x-forwarded-for")),
    email: parsed.value.customer.email,
  });
  if (!guard.ok) return { errors: {}, message: guard.message, values };

  const priceOptionId = String(form.get("price_option_id") ?? "");
  const sellerCode = String(form.get("seller") ?? "");
  const db = pool();
  // Rechtstexte und Vertriebsperson werden auf dem Server neu bestimmt, nie aus dem Formular übernommen.
  const legal = await currentLegalTexts(db);
  if (!legal.agb || !legal.datenschutz || !legal.widerruf) {
    return { errors: {}, message: "Bestellen ist gerade nicht möglich. Bitte versuche es später noch einmal.", values };
  }
  const sellerUserId = sellerCode ? await findSeller(db, sellerCode) : null;

  // Reverse Charge nur mit USt-IdNr., die VIES als gültig bestätigt (Unternehmen im EU-Ausland).
  const customer = parsed.value.customer;
  let vies: ViesResult | null = null;
  if (customer.kind === "unternehmen" && customer.vat_id && customer.country in EU_STANDARD_RATES_BP) {
    const company = (
      await db.query<{ country: string; vat_id: string | null }>(
        `select c.country, c.vat_id from app.price_options o join app.products p on p.id = o.product_id
           join app.companies c on c.id = p.company_id where o.id = $1`,
        [priceOptionId],
      )
    ).rows[0];
    if (company && customer.country !== company.country) {
      const expected = customer.country === "GR" ? "EL" : customer.country;
      if (splitVatId(customer.vat_id).countryCode !== expected) {
        return { errors: { vat_id: "Die USt-IdNr. passt nicht zum gewählten Land." }, message: "Bitte prüfe die markierten Angaben.", values };
      }
      vies = await checkVatId(customer.vat_id, company.vat_id);
      if (vies.valid === false) {
        return {
          errors: { vat_id: "Diese USt-IdNr. ist laut EU-Prüfung (VIES) nicht gültig. Ohne USt-IdNr. berechnen wir Umsatzsteuer." },
          message: "Bitte prüfe die markierten Angaben.",
          values,
        };
      }
    }
  }

  let orderId: string;
  try {
    const base = await publicBaseUrl();
    const placed = await transaction("system:checkout", async (c) => {
      const p = await placeOrder(c, {
        priceOptionId,
        customer,
        // VIES nicht erreichbar: wie ohne USt-IdNr., also mit Umsatzsteuer.
        vatIdVerified: vies?.valid === true,
        sellerUserId,
        agbVersionId: legal.agb!.id,
        privacyVersionId: legal.datenschutz!.id,
        withdrawalVersionId: legal.widerruf!.id,
        withdrawalWaiver: parsed.value.withdrawalWaiver,
        purchaseDay: todayBerlin(),
        couponCode: String(form.get("coupon") ?? "").trim() || null,
      });
      if (vies) {
        await c.query(
          `insert into app.vat_id_checks (order_id, country_code, vat_number, valid, consultation_number, registered_name, registered_address, response)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [p.orderId, vies.countryCode, vies.vatNumber, vies.valid, vies.consultationNumber, vies.name, vies.address, JSON.stringify(vies.response)],
        );
      }
      // Bestätigung mit Vertragstexten geht in derselben Transaktion in den Postausgang.
      await enqueueOrderConfirmation(c, p.orderId, `${base}/bestellung/${p.orderId}`);
      return p;
    });
    orderId = placed.orderId;
  } catch (err) {
    if (err instanceof CouponRejected) return { errors: { coupon: err.message }, message: "Bitte prüfe den Gutscheincode.", values };
    if (err instanceof OrderError) return { errors: {}, message: "Dieses Angebot ist leider nicht mehr verfügbar.", values };
    console.error("Bestellung fehlgeschlagen", (err as Error).message);
    return { errors: {}, message: "Die Bestellung hat nicht geklappt. Bitte versuche es noch einmal.", values };
  }
  redirect(`/bestellung/${orderId}`);
}

/** Öffentliche Adresse der Bestellseiten für Links in E-Mails. */
async function publicBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
}
