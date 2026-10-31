import { canChange } from "@idf/db/admin";
import { listProducts } from "@idf/db/products";
import { redirect } from "next/navigation";
import { couponValues } from "../../../../lib/coupon-form";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/session";
import { ActionForm } from "../../produkte/forms";
import { createCouponAction } from "../actions";
import { CouponFields } from "../coupon-fields";

export default async function NewCouponPage() {
  const user = await requireUser();
  if (!canChange(user)) redirect("/admin/gutscheine");
  const products = await listProducts(pool(), user, { filter: "alle" });
  return (
    <section className="card">
      <p>
        <a href="/admin/gutscheine">← Alle Gutscheine</a>
      </p>
      <h1>Neuer Gutschein</h1>
      <ActionForm action={createCouponAction} submit="Gutschein anlegen">
        <CouponFields values={couponValues(null)} products={products.map((p) => ({ id: p.id, name: p.name, active: p.active }))} locked={false} />
      </ActionForm>
    </section>
  );
}
