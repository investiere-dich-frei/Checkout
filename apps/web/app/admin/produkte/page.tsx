import { canChange, canSeeAll } from "@idf/db/admin";
import { listProducts } from "@idf/db/products";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { TAX_LABEL } from "../../../lib/product-form";
import { requireUser } from "../../../lib/session";

const FILTERS = { alle: "Alle", aktiv: "Freigeschaltet", inaktiv: "Abgeschaltet" } as const;

export default async function ProductsPage(props: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { q, filter: f } = await props.searchParams;
  const filter = f === "aktiv" || f === "inaktiv" ? f : "alle";
  const products = await listProducts(pool(), user, { search: q, filter });
  return (
    <section className="card">
      <div className="card-head">
        <h1>Produkte</h1>
        {canChange(user) && (
          <a className="button-link" href="/admin/produkte/neu">
            Neues Produkt anlegen
          </a>
        )}
      </div>
      <form className="inline-form" role="search">
        <label htmlFor="q">Suche nach Name, Adresse, Notiz oder Thrivecart-Nummer</label>
        <input id="q" name="q" type="search" defaultValue={q ?? ""} />
        <select name="filter" defaultValue={filter} aria-label="Status">
          {Object.entries(FILTERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="submit">Suchen</button>
      </form>
      <p className="note">{products.length} Produkte</p>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Status</th>
              <th>Steuer</th>
              <th>Preisoptionen</th>
              <th>Bestellungen</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`/admin/produkte/${p.id}`}>{p.name}</a>
                  <br />
                  <span className="note">
                    {p.slug ?? "ohne Adresse"}
                    {p.thrivecartProductId !== null && ` · Thrivecart ${p.thrivecartProductId}`}
                    {p.internalLabel && ` · ${p.internalLabel}`}
                  </span>
                </td>
                <td>{p.active ? <span className="badge badge-ok">freigeschaltet</span> : <span className="badge">abgeschaltet</span>}</td>
                <td>
                  {TAX_LABEL[p.taxCategory]}
                  {!p.taxConfirmed && (
                    <>
                      <br />
                      <span className="badge badge-warn">nicht bestätigt</span>
                    </>
                  )}
                </td>
                <td>
                  {p.activeOptions} aktiv{p.options > p.activeOptions && ` (von ${p.options})`}
                </td>
                <td>{p.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
