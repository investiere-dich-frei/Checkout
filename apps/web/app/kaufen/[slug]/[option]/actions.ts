"use server";

import { findSeller, currentLegalTexts } from "@idf/db/catalog";
import { OrderError, placeOrder } from "@idf/db/orders";
import { redirect } from "next/navigation";
import { parseCheckoutForm, type FieldErrors } from "../../../../lib/checkout-form";
import { pool, transaction } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";

export interface CheckoutState {
  errors: FieldErrors;
  message: string | null;
  /** Eingaben zurück an das Formular, damit nach einem Fehler nichts verloren geht. */
  values: Record<string, string>;
}

const KEPT_FIELDS = ["first_name", "last_name", "company_name", "email", "street", "postal_code", "city", "vat_id"];

export async function submitOrder(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const values = Object.fromEntries(KEPT_FIELDS.map((k) => [k, String(form.get(k) ?? "")]));
  const parsed = parseCheckoutForm(form);
  if (!parsed.ok) return { errors: parsed.errors, message: "Bitte prüfe die markierten Angaben.", values };

  const priceOptionId = String(form.get("price_option_id") ?? "");
  const sellerCode = String(form.get("seller") ?? "");
  const db = pool();
  // Rechtstexte und Vertriebsperson werden auf dem Server neu bestimmt, nie aus dem Formular übernommen.
  const legal = await currentLegalTexts(db);
  if (!legal.agb || !legal.datenschutz || !legal.widerruf) {
    return { errors: {}, message: "Bestellen ist gerade nicht möglich. Bitte versuche es später noch einmal.", values };
  }
  const sellerUserId = sellerCode ? await findSeller(db, sellerCode) : null;

  let orderId: string;
  try {
    const placed = await transaction("system:checkout", (c) =>
      placeOrder(c, {
        priceOptionId,
        customer: parsed.value.customer,
        vatIdVerified: false,
        sellerUserId,
        agbVersionId: legal.agb!.id,
        privacyVersionId: legal.datenschutz!.id,
        withdrawalVersionId: legal.widerruf!.id,
        withdrawalWaiver: parsed.value.withdrawalWaiver,
        purchaseDay: todayBerlin(),
      }),
    );
    orderId = placed.orderId;
  } catch (err) {
    if (err instanceof OrderError) return { errors: {}, message: "Dieses Angebot ist leider nicht mehr verfügbar.", values };
    console.error("Bestellung fehlgeschlagen", (err as Error).message);
    return { errors: {}, message: "Die Bestellung hat nicht geklappt. Bitte versuche es noch einmal.", values };
  }
  redirect(`/bestellung/${orderId}`);
}
