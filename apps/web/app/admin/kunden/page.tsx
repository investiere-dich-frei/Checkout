import { canSeeAll } from "@idf/db/admin";
import { listCustomers } from "@idf/db/customers";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/session";

const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });

export default async function CustomersPage(props: { searchParams: Promise<{ q?: string; seite?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { q, seite } = await props.searchParams;
  const page = Math.max(1, Number(seite) || 1);
  const rows = await listCustomers(pool(), user, { search: q, limit: 50, offset: (page - 1) * 50 });
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(p) })}`;
  return (
    <section className="card">
      <h1>Kunden</h1>
      <p className="note">Alle Käufe einer Person, auch die aus Thrivecart. Zusammengefasst wird über die E-Mail-Adresse.</p>
      <form className="inline-form" role="search">
        <label htmlFor="q">Suche nach Name, E-Mail, Firma oder Ort</label>
        <input id="q" name="q" type="search" defaultValue={q ?? ""} />
        <button type="submit">Suchen</button>
      </form>
      {rows.length === 0 ? (
        <p>Keine Treffer.</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kundin</th>
                <th>Land</th>
                <th>Käufe neu</th>
                <th>Käufe Thrivecart</th>
                <th>Letzter Kauf</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/admin/kunden/${r.id}`}>{r.name}</a>
                    <br />
                    <span className="note">{r.email}</span>
                  </td>
                  <td>{r.country}</td>
                  <td>{r.orders}</td>
                  <td>{r.legacyOrders}</td>
                  <td>{r.lastPurchaseAt ? day.format(r.lastPurchaseAt) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        {page > 1 && <a href={link(page - 1)}>Zurück</a>} {rows.length === 50 && <a href={link(page + 1)}>Weiter</a>}
      </p>
    </section>
  );
}
