import { currentLegalTexts } from "@idf/db/catalog";
import { placeOrder } from "@idf/db/orders";
import { pool, transaction } from "../lib/db";
import { todayBerlin } from "../lib/format";
import { completeCardSetup, preparePayment } from "../lib/payment";
import { stripe } from "../lib/stripe";
import { assertTestDatabase } from "../lib/stichtag";
import { parseTestkaufArgs } from "../lib/testkauf";

// Nur zum Testen: legt in der Testdatenbank eine Bestellung an und bezahlt sie über
// Stripe im Testmodus mit einer offiziellen Test-Zahlungsart (z. B. pm_card_visa,
// pm_card_chargeCustomerFail). Keine Kartennummern, kein Browser, kein echtes Geld.
// Verbucht wird wie bei einem echten Kauf über die Stripe-Meldung (Webhook).
//
//   pnpm --filter @idf/web testkauf --option <price_option_id> --email <adresse> [--karte pm_card_visa]
let args;
try {
  args = parseTestkaufArgs(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  console.error("Testkauf nur mit einem Stripe-Testschlüssel (sk_test_…) erlaubt");
  process.exit(2);
}
const db = pool();
try {
  await assertTestDatabase(db).catch((e: Error) => {
    console.error(e.message.replace("Stichtag", "Testkauf"));
    process.exit(2);
  });
  const api = stripe()!;
  const legal = await currentLegalTexts(db);
  if (!legal.agb || !legal.datenschutz || !legal.widerruf) throw new Error("Rechtstexte fehlen");

  const placed = await transaction("cli:testkauf", (c) =>
    placeOrder(c, {
      priceOptionId: args.option,
      // Ausgedachte Angaben, keine echten Kundendaten.
      customer: { kind: "privat", first_name: "Test", last_name: "Kauf", email: args.email, street: "Testweg 1", postal_code: "10115", city: "Berlin", country: "DE" },
      vatIdVerified: false,
      sellerUserId: null,
      agbVersionId: legal.agb!.id,
      privacyVersionId: legal.datenschutz!.id,
      withdrawalVersionId: legal.widerruf!.id,
      withdrawalWaiver: true,
      purchaseDay: todayBerlin(),
    }),
  );
  console.log(`Bestellung ${placed.orderId}`);

  const returnUrl = `${(process.env.PUBLIC_BASE_URL ?? "https://localhost").replace(/\/$/, "")}/bestellung/${placed.orderId}`;
  const payment = await preparePayment(api, placed.orderId);
  if (payment.state === "bereit") {
    const id = payment.clientSecret.split("_secret_")[0]!;
    const r = await api.paymentIntents.confirm(id, { payment_method: args.karte, return_url: returnUrl });
    console.log(`Zahlung ${payment.target.grossCents} Cent: ${r.status}. Verbucht wird über die Stripe-Meldung.`);
  } else if (payment.state === "karte_hinterlegen") {
    const id = payment.clientSecret.split("_secret_")[0]!;
    const r = await api.setupIntents.confirm(id, { payment_method: args.karte, return_url: returnUrl });
    const saved = r.status === "succeeded" && (await completeCardSetup(api, placed.orderId, id));
    console.log(`Karte hinterlegt: ${saved ? "ja" : `nein (${r.status})`}. Erste Zahlung am ${payment.setup.firstDueDate}.`);
  } else {
    console.log(`Keine Zahlung möglich: ${payment.state}`);
    process.exitCode = 1;
  }
} catch (e) {
  // Stripe-Fehler (z. B. abgelehnte Karte) mit Code, ohne Kundendaten.
  const err = e as { message: string; code?: string; decline_code?: string };
  console.error(`Testkauf fehlgeschlagen: ${err.decline_code ?? err.code ?? ""} ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
