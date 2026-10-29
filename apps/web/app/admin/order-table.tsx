import type { OrderRow } from "@idf/db/admin";
import { formatCents } from "../../lib/format";

const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

export function OrderTable({ orders }: { orders: OrderRow[] }) {
  if (!orders.length) return <p>Noch keine Bestellungen.</p>;
  return (
    <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Kundin</th>
            <th>Angebot</th>
            <th>Bezahlt / Gesamt</th>
            <th>Status</th>
            <th>Vertrieb</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <a href={`/admin/bestellungen/${o.id}`}>{dateTime.format(o.createdAt)}</a>
              </td>
              <td>
                {o.customerName}
                <br />
                <span className="note">{o.email}</span>
              </td>
              <td>
                {o.product}
                <br />
                <span className="note">{o.option}</span>
              </td>
              <td>
                {formatCents(o.paidCents, o.currency)} / {formatCents(o.totalCents, o.currency)}
              </td>
              <td>{o.status}</td>
              <td>{o.seller ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
