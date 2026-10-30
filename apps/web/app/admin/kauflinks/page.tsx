import { sellerLinks } from "@idf/db/admin";
import { headers } from "next/headers";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/session";

export default async function LinksPage() {
  const user = await requireUser();
  const links = await sellerLinks(pool(), user);
  const h = await headers();
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  return (
    <section className="card">
      <h1>Kauflinks</h1>
      {user.salesCode ? (
        <p>Diese Links ordnen Verkäufe dir zu (Kürzel „{user.salesCode}“).</p>
      ) : (
        <p className="note">Für dich ist kein Vertriebskürzel hinterlegt. Die Links ordnen Verkäufe niemandem zu.</p>
      )}
      {links.length === 0 ? (
        <p>Gerade ist kein Angebot freigeschaltet.</p>
      ) : (
        <table className="admin-table">
          <tbody>
            {links.map((l) => (
              <tr key={l.path}>
                <td>
                  {l.product}
                  <br />
                  <span className="note">{l.option}</span>
                </td>
                <td className="mono break">{base + l.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
