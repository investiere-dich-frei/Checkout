import { describeDiscount } from "@idf/core/discount";
import { canChange, canSeeAll } from "@idf/db/admin";
import { listCoupons } from "@idf/db/coupons";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { couponStatus } from "../../../lib/coupon-form";
import { formatCents, formatDay } from "../../../lib/format";
import { requireUser } from "../../../lib/session";

export default async function CouponsPage() {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const coupons = await listCoupons(pool(), user);
  return (
    <section className="card">
      <div className="card-head">
        <h1>Gutscheine</h1>
        {canChange(user) && (
          <a className="button-link" href="/admin/gutscheine/neu">
            Neuen Gutschein anlegen
          </a>
        )}
      </div>
      <p className="note">
        Kundinnen geben den Code auf der Kaufseite ein. Du kannst ihn auch direkt in den Kauflink hängen: <span className="mono">…?gutschein=CODE</span>
      </p>
      {coupons.length === 0 ? (
        <p>Noch keine Gutscheine angelegt.</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Rabatt</th>
                <th>Gilt für</th>
                <th>Zeitraum</th>
                <th>Eingelöst</th>
                <th>Ersparnis gesamt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const s = couponStatus(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={`/admin/gutscheine/${c.id}`} className="mono">
                        {c.code}
                      </a>
                      {c.label && (
                        <>
                          <br />
                          <span className="note">{c.label}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {describeDiscount(c, c.currency)}
                      <br />
                      <span className="note">{c.scope === "alle" ? "jede Zahlung" : "erste Zahlung"}</span>
                    </td>
                    <td>{c.allProducts ? "alle Produkte" : `${c.productIds.length} Produkt${c.productIds.length === 1 ? "" : "e"}`}</td>
                    <td>
                      {c.validFrom || c.validUntil
                        ? `${c.validFrom ? formatDay(c.validFrom) : "sofort"} – ${c.validUntil ? formatDay(c.validUntil) : "offen"}`
                        : "unbegrenzt"}
                    </td>
                    <td>
                      {c.redemptions}
                      {c.maxRedemptions !== null && ` / ${c.maxRedemptions}`}
                    </td>
                    <td>{formatCents(c.discountCents, c.currency)}</td>
                    <td>
                      <span className={s.ok ? "badge badge-ok" : "badge"}>{s.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
