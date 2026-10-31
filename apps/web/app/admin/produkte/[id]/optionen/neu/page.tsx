import { canChange } from "@idf/db/admin";
import { getProduct } from "@idf/db/products";
import { notFound, redirect } from "next/navigation";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/session";
import { createPriceOptionAction } from "../../../actions";
import { ActionForm, PriceOptionFields } from "../../../forms";

export default async function NewOptionPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canChange(user)) redirect("/admin/produkte");
  const { id } = await props.params;
  const product = await getProduct(pool(), user, id);
  if (!product) notFound();
  // Neue Optionen übernehmen brutto/netto der vorhandenen, damit ein Produkt einheitlich bleibt.
  const basis = product.options[0]?.amountBasis ?? "brutto";
  return (
    <section className="card">
      <p>
        <a href={`/admin/produkte/${product.id}`}>← {product.name}</a>
      </p>
      <h1>Neue Preisoption</h1>
      <p className="note">
        Nach dem Speichern ist das Produkt abgeschaltet, bis du die Steuer erneut bestätigst und es freischaltest. Verkaufte Preisoptionen lassen sich später
        nicht mehr ändern, nur abschalten.
      </p>
      <ActionForm action={createPriceOptionAction} submit="Preisoption speichern">
        <input type="hidden" name="product_id" value={product.id} />
        <PriceOptionFields
          values={{ label: "", kind: "einmal", amountBasis: basis, amount: "", recurringAmount: "", recurringCount: "", intervalMonths: "1", trialDays: "" }}
        />
      </ActionForm>
    </section>
  );
}
