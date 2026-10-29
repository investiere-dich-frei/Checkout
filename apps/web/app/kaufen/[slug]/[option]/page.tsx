import { currentLegalTexts, findSeller, getOffer } from "@idf/db/catalog";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CheckoutPage(props: {
  params: Promise<{ slug: string; option: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { slug, option } = await props.params;
  const { v } = await props.searchParams;
  if (!UUID.test(option)) notFound();

  const db = pool();
  const offer = await getOffer(db, slug, option);
  const legal = await currentLegalTexts(db);
  if (!offer || !legal.agb || !legal.datenschutz || !legal.widerruf) notFound();
  // Ein unbekanntes Kürzel verhindert keinen Kauf; die Bestellung läuft dann ohne Vertrieb.
  const sellerCode = v && (await findSeller(db, v)) ? v.toLowerCase() : null;

  return (
    <>
      <h1>{offer.productName}</h1>
      <p className="note">{offer.optionLabel}</p>
      <CheckoutForm
        slug={slug}
        offer={{
          priceOptionId: offer.priceOptionId,
          currency: offer.currency,
          amountBasis: offer.amountBasis,
          taxCategory: offer.taxCategory,
          chVatRateBp: offer.chVatRateBp,
          plan: offer.plan,
        }}
        sellerCode={sellerCode}
        purchaseDay={todayBerlin()}
        withdrawalText={legal.widerruf.content}
      />
    </>
  );
}
