import { canChange, canSeeAll, orderDetail } from "@idf/db/admin";
import { listPauses } from "@idf/db/billing";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents, formatDay, formatRate, todayBerlin } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { cancelOrderAction, endSubscriptionAction } from "../../actions";
import { chargeNowAction, pauseSubscriptionAction, resendInvoiceAction, resumeSubscriptionAction } from "../../kunden/actions";
import { ActionForm } from "../../produkte/forms";
import { RefundForm } from "./refund-form";

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
  const today = todayBerlin();
  const pauses = h.is_abo ? await listPauses(pool(), id) : [];
  const openPause = pauses.find((p) => !p.endedBy && (p.endsOn === null || p.endsOn >= today));
  const pauseText = (p: { startsOn: string; endsOn: string | null }) =>
    p.endsOn !== null && p.endsOn < p.startsOn ? `${formatDay(p.startsOn)} (aufgehoben)` : `${formatDay(p.startsOn)} bis ${p.endsOn ? formatDay(p.endsOn) : "auf Weiteres"}`;

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
        {h.is_manual && (
          <p className="notice-box">
            Bestellung per Rechnung (Überweisung). Zahlungen, Storno und Rückzahlung laufen über{" "}
            <a href={`/admin/manuell/${id}`}>Manuelle Bestellungen</a>.
          </p>
        )}
        <h2>Kundin</h2>
        <p>
          {canSeeAll(user) ? <a href={`/admin/kunden/${h.customer_id}`}>{name}</a> : name}
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
        {h.coupon_code && (
          <p>
            Gutschein{" "}
            {h.coupon_id ? <a href={`/admin/gutscheine/${h.coupon_id}`}>{h.coupon_code}</a> : h.coupon_code}: −{" "}
            {formatCents(Number(h.coupon_discount_cents), h.currency)}
            {h.coupon_scope === "alle" ? " (auf jede Zahlung)" : " (auf die erste Zahlung)"}
          </p>
        )}
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
        {canChange(user) &&
          !h.is_manual &&
          d.installments
            .filter((i) => (i.status === "offen" || i.status === "fehlgeschlagen") && i.due_date <= today)
            .map((i) => (
              <ActionForm
                key={i.id}
                action={chargeNowAction}
                className="inline-form"
                submit={`Rate ${i.seq} jetzt abbuchen`}
                confirm={`Rate ${i.seq} über ${formatCents(Number(i.gross_cents), h.currency)} jetzt von der gespeicherten Zahlungsart abbuchen?`}
              >
                <input type="hidden" name="order_id" value={id} />
                <input type="hidden" name="installment_id" value={i.id} />
              </ActionForm>
            ))}
        {canChange(user) && !h.is_manual && d.installments.some((i) => i.status === "offen" || i.status === "fehlgeschlagen") && (
          <form action={cancelOrderAction} className="inline-form">
            <input type="hidden" name="order_id" value={id} />
            <button type="submit">Offene Raten entfallen lassen (Bestellung beenden)</button>
          </form>
        )}
        {h.is_abo && pauses.length > 0 && (
          <>
            <h3>Pausen</h3>
            <ul>
              {pauses.map((p) => (
                <li key={p.id}>
                  {pauseText(p)}
                  {p.reason && <> · {p.reason}</>}
                </li>
              ))}
            </ul>
          </>
        )}
        {h.is_abo && canChange(user) && !h.ends_on && h.status !== "storniert" && h.status !== "erstattet" &&
          (openPause ? (
            <ActionForm action={resumeSubscriptionAction} className="inline-form" submit="Pause beenden, Abo fortsetzen" confirm="Pause beenden? Ab heute fällige Zahlungen werden wieder eingezogen.">
              <input type="hidden" name="order_id" value={id} />
            </ActionForm>
          ) : (
            <details>
              <summary>Abo pausieren</summary>
              <p className="note">Zahlungen, die in die Pause fallen, entfallen. Danach läuft das Abo zum bisherigen Rhythmus weiter. Ohne Enddatum bis zum Fortsetzen.</p>
              <ActionForm action={pauseSubscriptionAction} className="inline-form" submit="Pausieren">
                <input type="hidden" name="order_id" value={id} />
                <label htmlFor="starts_on">Ab</label>
                <input id="starts_on" name="starts_on" type="date" min={today} defaultValue={today} required />
                <label htmlFor="pause_ends_on">Bis einschließlich (optional)</label>
                <input id="pause_ends_on" name="ends_on" type="date" min={today} />
                <label htmlFor="reason">Grund (optional)</label>
                <input id="reason" name="reason" type="text" placeholder="z. B. Elternzeit" />
              </ActionForm>
            </details>
          ))}
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
        {canChange(user) &&
          !h.is_manual &&
          d.invoices
            .filter((i) => i.kind === "rechnung" && !d.invoices.some((s) => s.corrects_invoice_id === i.id))
            .map((i) => <RefundForm key={i.id} orderId={id} invoiceId={i.id} invoiceNumber={i.invoice_number} />)}
        {canChange(user) && d.invoices.length > 0 && (
          <details>
            <summary>Rechnung erneut per E-Mail senden</summary>
            {d.invoices.map((i) => (
              <ActionForm key={i.id} action={resendInvoiceAction} className="inline-form" submit={`${i.invoice_number} senden`}>
                <input type="hidden" name="invoice_id" value={i.id} />
                <label htmlFor={`to-${i.id}`}>An</label>
                <input id={`to-${i.id}`} name="to" type="email" defaultValue={h.email} />
              </ActionForm>
            ))}
          </details>
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
