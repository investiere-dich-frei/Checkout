"use server";

import { currentLegalTexts } from "@idf/db/catalog";
import { usableCheck } from "@idf/db/credit";
import { enqueueOrderConfirmation } from "@idf/db/customer-mails";
import { CouponRejected, CreditRequired, OrderError, placeOrder } from "@idf/db/orders";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pool, transaction } from "../../../../../../lib/db";
import { todayBerlin } from "../../../../../../lib/format";

export interface CreditOrderState {
  message: string | null;
  errors: Partial<Record<"terms" | "credit_agreement", string>>;
}

/** Zweiter Schritt beim Ratenkauf: Ratenvertrag schließen. Kundendaten kommen aus der Prüfung, nie aus dem Formular. */
export async function submitCreditOrder(_prev: CreditOrderState, form: FormData): Promise<CreditOrderState> {
  const errors: CreditOrderState["errors"] = {};
  if (form.get("terms") !== "on") errors.terms = "Bitte stimme den AGB zu und bestätige die Datenschutzhinweise.";
  if (form.get("credit_agreement") !== "on") errors.credit_agreement = "Bitte bestätige den Abschluss des Ratenzahlungsvertrags.";
  if (Object.keys(errors).length) return { errors, message: "Bitte prüfe die markierten Angaben." };

  const db = pool();
  const check = await usableCheck(db, String(form.get("check_id") ?? ""));
  if (!check) return { errors: {}, message: "Diese Anfrage ist abgelaufen oder schon verwendet. Bitte starte die Bestellung neu." };
  const legal = await currentLegalTexts(db);
  if (!legal.agb || !legal.datenschutz || !legal.widerruf) {
    return { errors: {}, message: "Bestellen ist gerade nicht möglich. Bitte versuche es später noch einmal." };
  }

  let orderId: string;
  try {
    const base = await publicBaseUrl();
    const placed = await transaction("system:checkout", async (c) => {
      const p = await placeOrder(c, {
        priceOptionId: check.priceOptionId,
        customer: { kind: "privat", ...check.customer },
        vatIdVerified: false,
        sellerUserId: check.sellerUserId,
        agbVersionId: legal.agb!.id,
        privacyVersionId: legal.datenschutz!.id,
        withdrawalVersionId: legal.widerruf!.id,
        withdrawalWaiver: false,
        purchaseDay: todayBerlin(),
        couponCode: check.couponCode,
        credit: { checkId: check.id, agreed: true, valueCompensation: form.get("value_compensation") === "on" },
      });
      await enqueueOrderConfirmation(c, p.orderId, `${base}/bestellung/${p.orderId}`);
      return p;
    });
    orderId = placed.orderId;
  } catch (err) {
    if (err instanceof CreditRequired || err instanceof CouponRejected) return { errors: {}, message: err.message };
    if (err instanceof OrderError) return { errors: {}, message: "Dieses Angebot ist leider nicht mehr verfügbar." };
    console.error("Ratenbestellung fehlgeschlagen", (err as Error).message);
    return { errors: {}, message: "Die Bestellung hat nicht geklappt. Bitte versuche es noch einmal." };
  }
  redirect(`/bestellung/${orderId}`);
}

async function publicBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
}
