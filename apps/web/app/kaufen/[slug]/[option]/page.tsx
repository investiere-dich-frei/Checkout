import { currentLegalTexts, findSeller, getOffer } from "@idf/db/catalog";
import { DEFAULT_CONTENT, resolvePage } from "@idf/db/checkout-pages";
import { notFound } from "next/navigation";
import { CheckoutPageView } from "../../../../lib/checkout-page-view";
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
  // Eine fehlerhafte Gestaltung darf den Verkauf nie verhindern.
  const content = await resolvePage(db, offer.productId).catch((err) => {
    console.error("Kaufseite: Gestaltung nicht lesbar, Vorgabe verwendet", (err as Error).message);
    return DEFAULT_CONTENT;
  });

  return (
    <CheckoutPageView
      content={content}
      productName={offer.productName}
      optionLabel={offer.optionLabel}
      form={
      <CheckoutForm
        slug={slug}
        offer={{
          priceOptionId: offer.priceOptionId,
          currency: offer.currency,
          amountBasis: offer.amountBasis,
          taxCategory: offer.taxCategory,
          chVatRateBp: offer.chVatRateBp,
          immediateAccess: offer.immediateAccess,
          plan: offer.plan,
        }}
        sellerCode={sellerCode}
        purchaseDay={todayBerlin()}
        withdrawalText={legal.widerruf.content}
      />
      }
    />
  );
}
