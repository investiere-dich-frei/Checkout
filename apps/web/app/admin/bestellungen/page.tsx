import { listOrders } from "@idf/db/admin";
import { searchLegacyOrders } from "@idf/db/customers";
import { pool } from "../../../lib/db";
import { formatCents } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { OrderTable } from "../order-table";

const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });

export default async function OrdersPage(props: { searchParams: Promise<{ q?: string; seite?: string }> }) {
  const user = await requireUser();
  const { q, seite } = await props.searchParams;
  const page = Math.max(1, Number(seite) || 1);
  const [orders, legacy] = await Promise.all([
    listOrders(pool(), user, { search: q, limit: 50, offset: (page - 1) * 50 }),
    page === 1 && q ? searchLegacyOrders(pool(), user, q) : Promise.resolve([]),
  ]);
  return (
    <>
      <section className="card">
        <h1>Bestellungen</h1>
        <form className="inline-form" role="search">
          <label htmlFor="q">Suche nach Name, E-Mail, Produkt oder Bestellnummer</label>
          <input id="q" name="q" type="search" defaultValue={q ?? ""} />
          <button type="submit">Suchen</button>
        </form>
        <OrderTable orders={orders} />
        <p>
          {page > 1 && <a href={`?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page - 1) })}`}>Zurück</a>}{" "}
          {orders.length === 50 && <a href={`?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page + 1) })}`}>Weiter</a>}
        </p>
      </section>
      {legacy.length > 0 && (
        <section className="card">
          <h2>Treffer aus Thrivecart</h2>
          <p className="note">Alt-Käufe bis zum Umstieg, nur zum Nachsehen. Suche auch nach Thrivecart-Bestell- oder Rechnungsnummer.</p>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Kundin</th>
                  <th>Produkt</th>
                  <th>Betrag</th>
                  <th>Rechnung</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {legacy.map((o) => (
                  <tr key={o.order_id}>
                    <td>{day.format(o.ordered_at)}</td>
                    <td>{o.customer_id ? <a href={`/admin/kunden/${o.customer_id}`}>{o.email}</a> : o.email}</td>
                    <td>
                      {o.product ?? "–"}
                      {o.option && (
                        <>
                          <br />
                          <span className="note">{o.option}</span>
                        </>
                      )}
                    </td>
                    <td>{formatCents(Number(o.gross_cents), o.currency)}</td>
                    <td>{o.invoice_number}</td>
                    <td>{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {legacy.length === 50 && <p className="note">Mehr als 50 Treffer, bitte genauer suchen.</p>}
        </section>
      )}
    </>
  );
}
