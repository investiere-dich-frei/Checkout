import { canChange } from "@idf/db/admin";
import { getStoredPage, listPageOverview } from "@idf/db/checkout-pages";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/session";

const berlinDate = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function PagesOverview() {
  const user = await requireUser();
  if (!canChange(user)) {
    return (
      <section className="card">
        <h1>Kaufseiten</h1>
        <p>Kaufseiten gestalten dürfen nur Admins.</p>
      </section>
    );
  }
  const db = pool();
  const [rows, standard] = await Promise.all([listPageOverview(db), getStoredPage(db, null)]);
  return (
    <section className="card">
      <h1>Kaufseiten</h1>
      <p>
        Hier gestaltest du die Kaufseiten wie im Thrivecart-Editor: Überschrift, Bilder, Texte, Aufzählungen, Zitate und
        Vertrauenshinweise. Preise, Bestellknopf und Rechtstexte kommen immer automatisch aus dem System.
      </p>
      <p>
        <a href="/admin/seiten/standard">
          <strong>Standardseite bearbeiten</strong>
        </a>{" "}
        <span className="note">
          (gilt für alle Produkte ohne eigene Seite und liefert das Logo
          {standard ? `, zuletzt geändert am ${berlinDate(standard.updatedAt)}` : ", noch nicht gestaltet"})
        </span>
      </p>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Status</th>
              <th>Seite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>
                  <a href={`/admin/seiten/${r.productId}`}>{r.name}</a>
                  {r.slug && (
                    <>
                      <br />
                      <span className="note mono">{r.slug}</span>
                    </>
                  )}
                </td>
                <td>{r.active ? "freigeschaltet" : "nicht freigeschaltet"}</td>
                <td>{r.hasOwnPage ? `eigene Seite (${berlinDate(r.updatedAt!)})` : "Standardseite"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
