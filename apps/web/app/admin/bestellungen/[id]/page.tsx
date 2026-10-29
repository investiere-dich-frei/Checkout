import { canChange, orderDetail } from "@idf/db/admin";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents, formatDay, formatRate, todayBerlin } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { endSubscriptionAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

export default async function OrderAdminPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const d = await orderDetail(pool(), user, id);
  if (!d) notFound();
  const h = d.head;
  const name = h.company_name || [h.first_name, h.last_name].filter(Boolean).join(" ");

  return (
    <>
      <section className="card">
        <h1>
          {h.product} – {h.option}
        </h1>
        <p className="note">
          Bestellung {id} · {dateTime.format(h.created_at)} · Status {h.status}
          {h.seller && <> · Vertrieb: {h.seller}</>}
        </p>
        <h2>Kundin</h2>
        <p>
          {name}
          <br />
          {h.email}
          <br />
          {[h.street, [h.postal_code, h.city].filter(Boolean).join(" "), h.country].filter(Boolean).join(", ")}
          {h.vat_id && (
            <>
              <br />
              USt-IdNr. {h.vat_id}
            </>
          )}
        </p>
        <p>
          Steuer: {formatRate(h.tax_rate_bp)}
          {h.tax_note && <> · {h.tax_note}</>}
          {h.withdrawal_waiver_at && <> · Verzicht auf Widerrufsrecht am {dateTime.format(h.withdrawal_waiver_at)}</>}
        </p>
      </section>

      <section className="card">
        <h2>Zahlplan</h2>
        <table className="admin-table">
          <tbody>
            {d.installments.map((i) => (
              <tr key={i.id}>
                <td>Rate {i.seq}</td>
                <td>{formatDay(i.due_date)}</td>
                <td>{formatCents(Number(i.gross_cents), h.currency)}</td>
                <td>{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {h.is_abo && (
          <p>
            {h.ends_on ? (
              <>Abo endet am {formatDay(h.ends_on)}.</>
            ) : canChange(user) ? (
              <form action={endSubscriptionAction} className="inline-form">
                <input type="hidden" name="order_id" value={id} />
                <label htmlFor="ends_on">Abo beenden zum (letzter Tag der Laufzeit)</label>
                <input id="ends_on" name="ends_on" type="date" min={todayBerlin()} required />
                <button type="submit">Abo beenden</button>
              </form>
            ) : (
              <>Abo läuft.</>
            )}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Rechnungen</h2>
        {d.invoices.length === 0 ? (
          <p>Noch keine.</p>
        ) : (
          <table className="admin-table">
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.has_pdf ? <a href={`/bestellung/${id}/rechnung/${i.id}`}>{i.invoice_number}</a> : i.invoice_number}</td>
                  <td>{i.kind}</td>
                  <td>{formatDay(i.issue_date)}</td>
                  <td>{formatCents(Number(i.gross_cents), h.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(d.notices.length > 0 || d.attempts.length > 0) && (
        <section className="card">
          {d.notices.length > 0 && (
            <>
              <h2>Kündigungen und Widerrufe</h2>
              <ul>
                {d.notices.map((n) => (
                  <li key={n.id}>
                    {n.kind === "kuendigung" ? "Kündigung" : "Widerruf"} vom {dateTime.format(n.received_at)}
                    {n.resolution ? ` · erledigt: ${n.resolution}` : " · offen"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.attempts.length > 0 && (
            <>
              <h2>Einzugsversuche</h2>
              <ul>
                {d.attempts.map((a, idx) => (
                  <li key={idx}>
                    Rate {a.seq} · {dateTime.format(a.attempted_at)} · {a.provider} · {a.outcome}
                    {a.error_code && ` (${a.error_code})`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
