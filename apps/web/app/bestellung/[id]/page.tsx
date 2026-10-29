import { notFound } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents, formatDay } from "../../../lib/format";
import { preparePayment } from "../../../lib/payment";
import { publishableKey, stripe } from "../../../lib/stripe";
import { PaymentForm } from "./payment-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ redirect_status?: string }>;
}) {
  const { id } = await props.params;
  const { redirect_status } = await props.searchParams;
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
  const key = publishableKey();
  let payment: Awaited<ReturnType<typeof preparePayment>> | null = null;
  try {
    payment = await preparePayment(key ? stripe() : null, id);
  } catch (err) {
    // Stripe nicht erreichbar: Seite trotzdem zeigen, ohne Kundendaten im Log.
    console.error("Zahlung konnte nicht vorbereitet werden", (err as Error).message);
  }

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
              <td>
                Fällig am {formatDay(r.due_date)}
                {r.installment_status !== "offen" && <span className="note"> · {r.installment_status}</span>}
              </td>
              <td>{formatCents(Number(r.gross_cents), first.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!payment ? (
        <p className="error" role="alert">
          Bezahlen ist gerade nicht möglich. Bitte lade die Seite in ein paar Minuten neu.
        </p>
      ) : payment.state === "bereit" && key ? (
        <>
          <h2 style={{ marginTop: 24 }}>Bezahlen</h2>
          {redirect_status === "failed" && (
            <p className="error" role="alert">
              Die Zahlung hat nicht geklappt. Bitte versuche es noch einmal oder wähle eine andere Zahlungsart.
            </p>
          )}
          <PaymentForm
            publishableKey={key}
            clientSecret={payment.clientSecret}
            orderId={id}
            amountLabel={formatCents(payment.target.grossCents, payment.target.currency)}
          />
          {payment.target.recurring && (
            <p className="note">Die folgenden Zahlungen werden zum Fälligkeitstag mit derselben Zahlungsart eingezogen.</p>
          )}
        </>
      ) : payment.state === "in_bearbeitung" || (payment.state !== "nichts_faellig" && redirect_status === "succeeded") ? (
        <p className="note">Danke, deine Zahlung ist unterwegs. Die Rechnung bekommst du per E-Mail, sobald sie bestätigt ist.</p>
      ) : payment.state === "nichts_faellig" ? (
        <p className="note">
          {rows.some((r) => r.installment_status === "offen")
            ? "Danke, die fällige Zahlung ist eingegangen. Die nächsten Raten werden zum Fälligkeitstag eingezogen."
            : "Alles bezahlt. Die Rechnung bekommst du per E-Mail."}
        </p>
      ) : (
        <p className="note">Die Zahlung folgt im nächsten Schritt. Die Rechnung bekommst du per E-Mail, sobald die Zahlung eingegangen ist.</p>
      )}
    </section>
  );
}
