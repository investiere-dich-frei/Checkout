import { describeDiscount } from "@idf/core/discount";
import { canChange, canSeeAll } from "@idf/db/admin";
import { couponRedemptions, getCoupon } from "@idf/db/coupons";
import { listProducts } from "@idf/db/products";
import { notFound, redirect } from "next/navigation";
import { couponStatus, couponValues } from "../../../../lib/coupon-form";
import { pool } from "../../../../lib/db";
import { formatCents } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { ActionForm } from "../../produkte/forms";
import { setCouponActiveAction, updateCouponAction } from "../actions";
import { CouponFields } from "../coupon-fields";

const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

export default async function CouponPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { id } = await props.params;
  const { neu } = await props.searchParams;
  const coupon = await getCoupon(pool(), user, id);
  if (!coupon) notFound();
  const [products, redemptions] = await Promise.all([listProducts(pool(), user, { filter: "alle" }), couponRedemptions(pool(), user, id)]);
  const edit = canChange(user);
  const status = couponStatus(coupon);
  const names = new Map(products.map((p) => [p.id, p.name]));

  return (
    <>
      <section className="card">
        <p>
          <a href="/admin/gutscheine">← Alle Gutscheine</a>
        </p>
        {neu && <p className="status-ok">Gutschein angelegt. Er ist sofort einlösbar, sofern der Zeitraum passt.</p>}
        <div className="card-head">
          <h1 className="mono">{coupon.code}</h1>
          <span className={status.ok ? "badge badge-ok" : "badge"}>{status.text}</span>
        </div>
        <p>
          {describeDiscount(coupon, coupon.currency)} · {coupon.scope === "alle" ? "auf jede Zahlung" : "auf die erste Zahlung"} ·{" "}
          {coupon.allProducts ? "alle Produkte" : coupon.productIds.map((p) => names.get(p) ?? p).join(", ")}
        </p>
        <p className="note">
          {coupon.redemptions} Mal eingelöst{coupon.maxRedemptions !== null && ` von höchstens ${coupon.maxRedemptions}`} · Ersparnis der Kundinnen gesamt{" "}
          {formatCents(coupon.discountCents, coupon.currency)} · Link-Zusatz für Kauflinks: <span className="mono">?gutschein={coupon.code}</span> (mit Vertriebskürzel:{" "}
          <span className="mono">?v=kürzel&amp;gutschein={coupon.code}</span>)
        </p>
        {edit && (
          <ActionForm
            action={setCouponActiveAction}
            submit={coupon.active ? "Gutschein abschalten" : "Gutschein einschalten"}
            className="inline-form"
            confirm={coupon.active ? "Gutschein abschalten? Er ist dann nicht mehr einlösbar." : undefined}
          >
            <input type="hidden" name="coupon_id" value={coupon.id} />
            <input type="hidden" name="active" value={coupon.active ? "0" : "1"} />
          </ActionForm>
        )}
      </section>

      {edit && (
        <section className="card">
          <h2>Bearbeiten</h2>
          <ActionForm action={updateCouponAction} submit="Speichern">
            <input type="hidden" name="coupon_id" value={coupon.id} />
            <CouponFields values={couponValues(coupon)} products={products.map((p) => ({ id: p.id, name: p.name, active: p.active }))} locked={coupon.locked} />
          </ActionForm>
        </section>
      )}

      <section className="card">
        <h2>Einlösungen</h2>
        {redemptions.length === 0 ? (
          <p>Noch nicht eingelöst.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Kundin</th>
                  <th>Produkt</th>
                  <th>Status</th>
                  <th>Preis ohne Gutschein</th>
                  <th>Rabatt</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.orderId}>
                    <td>
                      <a href={`/admin/bestellungen/${r.orderId}`}>{dateTime.format(r.createdAt)}</a>
                    </td>
                    <td>{r.customerName}</td>
                    <td>{r.product}</td>
                    <td>{r.status}</td>
                    <td>{formatCents(r.listCents, r.currency)}</td>
                    <td>− {formatCents(r.discountCents, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
