import { canSeeAll, listOrders, orderFilterOptions } from "@idf/db/admin";
import { searchLegacyOrders } from "@idf/db/customers";
import { pool } from "../../../lib/db";
import { formatCents, todayBerlin } from "../../../lib/format";
import { filterQuery, PAYMENT_LABELS, readOrderFilter, STATE_LABELS, STATUS_LABELS, type FilterParams } from "../../../lib/order-filter";
import { requireUser } from "../../../lib/session";
import { OrderTable } from "../order-table";

const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });
const PAGE = 50;

export default async function OrdersPage(props: { searchParams: Promise<FilterParams & { seite?: string }> }) {
  const user = await requireUser();
  const params = await props.searchParams;
  const { q, seite } = params;
  const page = Math.max(1, Number(seite) || 1);
  const filter = readOrderFilter(params);
  const filtered = Object.keys(filter).some((k) => k !== "search");
  const [orders, legacy, options] = await Promise.all([
    listOrders(pool(), user, { ...filter, today: todayBerlin(), limit: PAGE, offset: (page - 1) * PAGE }),
    page === 1 && q && !filtered ? searchLegacyOrders(pool(), user, q) : Promise.resolve([]),
    orderFilterOptions(pool(), user),
  ]);
  const admin = canSeeAll(user);
  const select = (name: keyof FilterParams, label: string, entries: [string, string][]) => (
    <label>
      {label}
      <select name={name} defaultValue={params[name] ?? ""}>
        <option value="">Alle</option>
        {entries.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <section className="card">
        <h1>Bestellungen</h1>
        <form className="filter-form" role="search">
          <label className="filter-wide">
            Suche nach Name, E-Mail, Produkt oder Bestellnummer
            <input name="q" type="search" defaultValue={q ?? ""} />
          </label>
          <label>
            Bestellt ab
            <input name="von" type="date" defaultValue={params.von ?? ""} />
          </label>
          <label>
            Bestellt bis
            <input name="bis" type="date" defaultValue={params.bis ?? ""} />
          </label>
          {select("lage", "Lage", Object.entries(STATE_LABELS))}
          {select("status", "Status", Object.entries(STATUS_LABELS))}
          {select("zahlung", "Zahlungsart", Object.entries(PAYMENT_LABELS))}
          {select("produkt", "Produkt", options.products.map((p) => [p.id, p.name]))}
          {select("land", "Land", options.countries.map((c) => [c, c]))}
          {admin && select("vertrieb", "Vertrieb", options.sellers.map((s) => [s.id, s.display_name]))}
          <div className="filter-actions">
            <button type="submit">Anzeigen</button>
            {(filtered || q) && <a href="/admin/bestellungen">Filter zurücksetzen</a>}
            {admin && <a href={`/admin/bestellungen/export?${filterQuery(params)}`}>Als CSV herunterladen</a>}
          </div>
        </form>
        {params.lage === "ueberfaellig" && (
          <p className="note">Überfällig: Eine Rate oder Abozahlung ist fällig und noch offen oder fehlgeschlagen.</p>
        )}
        <OrderTable orders={orders} />
        {orders.length === 0 && <p className="note">Keine Bestellungen zu diesen Filtern.</p>}
        <p>
          {page > 1 && <a href={`?${filterQuery(params, { seite: String(page - 1) })}`}>Zurück</a>}{" "}
          {orders.length === PAGE && <a href={`?${filterQuery(params, { seite: String(page + 1) })}`}>Weiter</a>}
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
