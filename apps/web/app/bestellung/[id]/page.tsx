import { notFound } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents, formatDay } from "../../../lib/format";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const { rows } = await pool().query(
    `select o.status, o.currency, p.name, po.label, i.seq, i.due_date::text, i.gross_cents, i.status installment_status
       from app.orders o
       join app.order_items it on it.order_id = o.id
       join app.price_options po on po.id = it.price_option_id
       join app.products p on p.id = po.product_id
       join app.order_installments i on i.order_item_id = it.id
      where o.id = $1
      order by i.seq`,
    [id],
  );
  if (!rows.length) notFound();
  const first = rows[0];

  return (
    <section className="card">
      <h1>Danke für deine Bestellung</h1>
      <p>
        {first.name} – {first.label}
      </p>
      <table className="summary-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq}>
              <td>Fällig am {formatDay(r.due_date)}</td>
              <td>{formatCents(Number(r.gross_cents), first.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">Die Zahlung folgt im nächsten Schritt. Die Rechnung bekommst du per E-Mail, sobald die Zahlung eingegangen ist.</p>
    </section>
  );
}
