import { MANUAL_MODEL_LABEL } from "@idf/core/manual-plan";
import { canChange } from "@idf/db/admin";
import { MANUAL_STATUS_LABEL, manualOrderDetail, type ManualStatus } from "@idf/db/manual-orders";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents, formatDay, formatRate, todayBerlin } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { ActionForm } from "../../produkte/forms";
import { cancelManualOrderAction, recordManualPaymentAction, recordManualRefundAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
const INSTALLMENT: Record<string, string> = { offen: "offen", fehlgeschlagen: "offen", bezahlt: "bezahlt", storniert: "entfallen", erlassen: "erlassen" };
const EVENT: Record<string, string> = { angelegt: "Angelegt", zahlung: "Zahlung", storno: "Storno", rueckzahlung: "Rückzahlung" };

export default async function ManualOrderPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  const user = await requireUser();
  const { id } = await props.params;
  const { neu } = await props.searchParams;
  if (!UUID.test(id)) notFound();
  const today = todayBerlin();
  const d = await manualOrderDetail(pool(), user, id, today);
  if (!d) notFound();
  const h = d.head;
  const status = h.status as ManualStatus;
  const name = [h.first_name, h.last_name].filter(Boolean).join(" ");
  const admin = canChange(user);
  const cancelled = !!h.cancelled_at;
  // Verbucht wird der Reihe nach: das Formular steht nur an der nächsten offenen Zahlung.
  const nextOpen = d.installments.find((i) => i.status === "offen" || i.status === "fehlgeschlagen")?.id;
  const paidCents = d.installments
    .filter((i) => i.paid_on)
    .reduce((t: number, i: { gross_cents: string }) => t + Number(i.gross_cents), 0);

  return (
    <>
      <section className="card">
        <p>
          <a href="/admin/manuell">← Manuelle Bestellungen</a>
        </p>
        {neu && (
          <p className="notice-box">
            Rechnung {h.invoice_number} ist ausgestellt
            {d.mails.length > 0 ? " und geht per E-Mail an die Kundin." : ". Es wurde keine E-Mail verschickt."}
          </p>
        )}
        <div className="card-head">
          <h1>
            Rechnung {h.invoice_number} · {h.product}
          </h1>
          <span className={status === "bezahlt" ? "badge badge-ok" : status === "ueberfaellig" || status === "rueckzahlung_offen" ? "badge badge-warn" : "badge"}>
            {MANUAL_STATUS_LABEL[status]}
          </span>
        </div>
        <dl className="facts">
          <dt>Kundin</dt>
          <dd>
            {h.company_name && (
              <>
                {h.company_name}
                <br />
              </>
            )}
            {name}
            <br />
            {h.email}
            <br />
            {[h.street, [h.postal_code, h.city].filter(Boolean).join(" "), h.country].filter(Boolean).join(", ")}
            {h.vat_id && <> · USt-IdNr. {h.vat_id}</>}
          </dd>
          <dt>Betrag</dt>
          <dd>
            {formatCents(Number(h.total_gross_cents), h.currency)} · {MANUAL_MODEL_LABEL[h.payment_model as keyof typeof MANUAL_MODEL_LABEL]} · Steuer{" "}
            {formatRate(h.tax_rate_bp)}
            {h.tax_note && <> ({h.tax_note})</>}
          </dd>
          <dt>Rechnung</dt>
          <dd>
            {h.invoice_pdf ? <a href={`/bestellung/${id}/rechnung/${h.invoice_id}`}>{h.invoice_number} (PDF)</a> : h.invoice_number} vom {formatDay(h.issue_date)} ·
            Zahlungsziel {formatDay(h.pay_by)}
          </dd>
          {h.storno_number && (
            <>
              <dt>Stornorechnung</dt>
              <dd>
                {h.storno_pdf ? <a href={`/bestellung/${id}/rechnung/${h.storno_invoice_id}`}>{h.storno_number} (PDF)</a> : h.storno_number} vom{" "}
                {formatDay(h.storno_date)} · {h.cancelled_by_name}: {h.cancel_reason}
              </dd>
            </>
          )}
          <dt>Vertrieb</dt>
          <dd>
            {h.seller ?? "ohne Vertrieb"} · erfasst von {h.created_by_name} am {dateTime.format(h.created_at)}
          </dd>
          {h.internal_note && (
            <>
              <dt>Interne Notiz</dt>
              <dd>{h.internal_note}</dd>
            </>
          )}
        </dl>
        <p className="note">
          <a href={`/admin/bestellungen/${id}`}>Zur Bestellung</a>
        </p>
      </section>

      <section className="card">
        <h2>Zahlungen</h2>
        <table className="admin-table">
          <tbody>
            {d.installments.map((i) => (
              <tr key={i.id}>
                <td>Zahlung {i.seq}</td>
                <td>
                  {i.seq === 1 ? "bis " : ""}
                  {formatDay(i.due)}
                </td>
                <td>{formatCents(Number(i.gross_cents), h.currency)}</td>
                <td>
                  {i.paid_on ? `bezahlt am ${formatDay(i.paid_on)}` : INSTALLMENT[i.status] ?? i.status}
                  {!i.paid_on && (i.status === "offen" || i.status === "fehlgeschlagen") && i.due < today && (
                    <>
                      {" "}
                      <span className="badge badge-warn">überfällig</span>
                    </>
                  )}
                  {admin && !cancelled && i.id === nextOpen && (
                    <ActionForm action={recordManualPaymentAction} submit="Zahlung verbuchen" className="inline-form mini-form">
                      <input type="hidden" name="order_id" value={id} />
                      <input type="hidden" name="installment_id" value={i.id} />
                      <label htmlFor={`paid-${i.id}`}>Eingang auf dem Konto am</label>
                      <input id={`paid-${i.id}`} name="paid_on" type="date" max={today} defaultValue={today} required />
                      <input type="text" name="reference" placeholder="Referenz (optional)" aria-label="Referenz" />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!admin && !cancelled && status !== "bezahlt" && <p className="note">Zahlungseingänge verbucht die Buchhaltung.</p>}
      </section>

      {admin && !cancelled && (
        <section className="card">
          <h2>Stornieren</h2>
          <p className="note">
            Es entsteht eine Stornorechnung über den vollen Betrag der Rechnung {h.invoice_number}; offene Zahlungen entfallen.
            {paidCents > 0
              ? ` Bereits gezahlt sind ${formatCents(paidCents, h.currency)}. Das Geld überweist ihr danach zurück und verbucht es hier als Rückzahlung; der Kurszugang wird beendet.`
              : " Es ist noch nichts gezahlt, also auch nichts zurückzuzahlen."}
          </p>
          <ActionForm
            action={cancelManualOrderAction}
            submit="Stornieren"
            confirm={`Rechnung ${h.invoice_number} wirklich stornieren? Das lässt sich nicht rückgängig machen.`}
          >
            <input type="hidden" name="order_id" value={id} />
            <div className="field">
              <label htmlFor="reason">Grund (intern, steht nicht auf der Stornorechnung)</label>
              <input type="text" id="reason" name="reason" required placeholder="z. B. Kundin hat nicht bezahlt, Widerruf vom 03.11." />
            </div>
            <div className="field check">
              <input id="notify" name="notify" type="checkbox" defaultChecked />
              <label htmlFor="notify">Stornorechnung per E-Mail an die Kundin schicken</label>
            </div>
          </ActionForm>
        </section>
      )}

      {admin && status === "rueckzahlung_offen" && (
        <section className="card">
          <h2>Rückzahlung verbuchen</h2>
          <p>
            Zurückzuzahlen: <strong>{formatCents(Number(h.refund_due_cents), h.currency)}</strong> an {name}. Erst überweisen, dann hier verbuchen.
          </p>
          <ActionForm action={recordManualRefundAction} submit="Rückzahlung verbuchen" className="inline-form mini-form">
            <input type="hidden" name="order_id" value={id} />
            <label htmlFor="refunded_on">Überwiesen am</label>
            <input id="refunded_on" name="refunded_on" type="date" max={today} defaultValue={today} required />
            <input type="text" name="reference" placeholder="Referenz (optional)" aria-label="Referenz" />
          </ActionForm>
        </section>
      )}

      <section className="card">
        <h2>Verlauf</h2>
        <ul>
          {d.events.map((e, n) => (
            <li key={n}>
              {dateTime.format(e.created_at)} · {EVENT[e.kind] ?? e.kind} · {e.display_name}: {e.detail}
            </li>
          ))}
          {d.mails.map((m, n) => (
            <li key={`m${n}`}>
              {dateTime.format(m.created_at)} · E-Mail „{m.subject}“ {m.sent_at ? `verschickt ${dateTime.format(m.sent_at)}` : m.last_error ? "noch nicht verschickt (wird wiederholt)" : "wartet auf Versand"}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
