import { canChange } from "@idf/db/admin";
import { getProduct } from "@idf/db/products";
import { notFound, redirect } from "next/navigation";
import { pool } from "../../../../../../lib/db";
import { centsToInput } from "../../../../../../lib/product-form";
import { requireUser } from "../../../../../../lib/session";
import { updatePriceOptionAction } from "../../../actions";
import { ActionForm, PriceOptionFields } from "../../../forms";

export default async function EditOptionPage(props: { params: Promise<{ id: string; optionId: string }> }) {
  const user = await requireUser();
  if (!canChange(user)) redirect("/admin/produkte");
  const { id, optionId } = await props.params;
  const product = await getProduct(pool(), user, id);
  const o = product?.options.find((x) => x.id === optionId);
  if (!product || !o) notFound();
  return (
    <section className="card">
      <p>
        <a href={`/admin/produkte/${product.id}`}>← {product.name}</a>
      </p>
      <h1>Preisoption ändern</h1>
      {o.sold > 0 ? (
        <p className="status-error">
          Diese Preisoption wurde {o.sold}-mal verkauft. Preis und Zahlplan bleiben deshalb fest (GoBD). Lege für einen neuen Preis eine neue Preisoption an und
          schalte diese ab.
        </p>
      ) : (
        <>
          <p className="note">Nach dem Speichern ist das Produkt abgeschaltet, bis du die Steuer erneut bestätigst und es freischaltest.</p>
          <ActionForm action={updatePriceOptionAction} submit="Änderungen speichern">
            <input type="hidden" name="option_id" value={o.id} />
            <PriceOptionFields
              values={{
                label: o.label,
                kind: o.kind,
                amountBasis: o.amountBasis,
                amount: centsToInput(o.amountCents),
                recurringAmount: centsToInput(o.recurringAmountCents),
                recurringCount: o.recurringCount === null ? "" : String(o.recurringCount),
                intervalMonths: o.intervalMonths === null ? "1" : String(o.intervalMonths),
                trialDays: o.trialDays === null ? "" : String(o.trialDays),
              }}
            />
          </ActionForm>
        </>
      )}
    </section>
  );
}
