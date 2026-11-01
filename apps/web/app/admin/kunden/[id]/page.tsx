import { canChange } from "@idf/db/admin";
import { customerDetail } from "@idf/db/customers";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { ActionForm } from "../../produkte/forms";
import { sendPortalLinkAction, updateCustomerAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });
const fmtDay = (d: Date | null) => (d ? day.format(d) : "–");

/** Status aus Thrivecart in Worten; unbekannte bleiben, wie sie sind. */
const LEGACY_STATUS: Record<string, string> = {
  active: "läuft",
  cancelled: "gekündigt",
  canceled: "gekündigt",
  completed: "abgeschlossen",
  paused: "pausiert",
  overdue: "überfällig",
  refunded: "erstattet",
  paid: "bezahlt",
};
const legacyStatus = (s: string) => LEGACY_STATUS[s.toLowerCase()] ?? s;

export default async function CustomerPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const d = await customerDetail(pool(), user, id);
  if (!d) notFound();
  const p = d.profile;
  const name = p.company_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
  const legacyCents = d.legacyOrders.reduce((t: number, o: { gross_cents: string | null; status: string }) => t + (/refund/i.test(o.status) ? 0 : Number(o.gross_cents ?? 0)), 0);

  return (
    <>
      <section className="card">
        <p>
          <a href="/admin/kunden">← Alle Kunden</a>
        </p>
        <h1>{name}</h1>
        <p>
          {p.email}
          <br />
          {[p.street, [p.postal_code, p.city].filter(Boolean).join(" "), p.country].filter(Boolean).join(", ")}
          {p.vat_id && (
            <>
              <br />
              USt-IdNr. {p.vat_id}
            </>
          )}
        </p>
        <p className="note">
          Neu abgerechnet: {formatCents(d.invoicedCents)} (Rechnungen abzüglich Stornos) · Thrivecart: {formatCents(legacyCents)} (Erstkäufe, ohne erstattete) ·{" "}
          {d.recordCount} Datensätze unter dieser E-Mail
        </p>
      </section>

      <section className="card">
        <h2>Käufe</h2>
        {d.orders.length === 0 ? (
          <p>Noch keine im neuen System.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Angebot</th>
                  <th>Bezahlt / Gesamt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <a href={`/admin/bestellungen/${o.id}`}>{fmtDay(o.created_at)}</a>
                    </td>
                    <td>
                      {o.product}
                      <br />
                      <span className="note">{o.option}</span>
                    </td>
                    <td>
                      {formatCents(Number(o.paid), o.currency)} / {formatCents(Number(o.total_gross_cents), o.currency)}
                    </td>
                    <td>
                      {o.status}
                      {o.is_abo && <> · {o.ends_on ? `Abo endet ${o.ends_on.split("-").reverse().join(".")}` : "Abo läuft"}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(d.legacyOrders.length > 0 || d.legacySubscriptions.length > 0) && (
        <section className="card">
          <h2>Aus Thrivecart</h2>
          <p className="note">Nur zum Nachsehen. Laufende Thrivecart-Abos werden weiter in Thrivecart verwaltet, bis sie umgezogen sind.</p>
          {d.legacySubscriptions.length > 0 && (
            <>
              <h3>Abos und Ratenpläne</h3>
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Produkt</th>
                      <th>Betrag</th>
                      <th>Zahlungen</th>
                      <th>Nächste Zahlung</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.legacySubscriptions.map((s) => (
                      <tr key={s.subscription_id}>
                        <td>
                          {s.product ?? "–"}
                          <br />
                          <span className="note">
                            Rechnung {s.invoice_number ?? "–"} · {s.processor ?? "–"}
                          </span>
                        </td>
                        <td>
                          {s.amount_cents != null ? formatCents(Number(s.amount_cents), s.currency ?? "EUR") : "–"} {s.frequency ?? ""}
                        </td>
                        <td>
                          {s.payments_made ?? 0} gezahlt
                          {s.payments_remaining != null && <>, {s.payments_remaining} offen</>}
                        </td>
                        <td>{fmtDay(s.next_payment_at)}</td>
                        <td>{legacyStatus(s.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {d.legacyOrders.length > 0 && (
            <>
              <h3>Käufe</h3>
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Produkt</th>
                      <th>Betrag</th>
                      <th>Rechnung</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.legacyOrders.map((o) => (
                      <tr key={o.order_id}>
                        <td>{fmtDay(o.ordered_at)}</td>
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
                        <td>{legacyStatus(o.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {canChange(user) && (
        <section className="card">
          <h2>Kundenbereich</h2>
          <p className="note">
            Schickt der Kundin einen Link zu ihrem Kundenbereich (Bestellungen, Rechnungen, Karte ändern), gültig 7 Tage. Selbst anfordern kann sie ihn
            unter /konto.
          </p>
          <ActionForm action={sendPortalLinkAction} className="inline-form" submit="Link zum Kundenbereich schicken">
            <input type="hidden" name="email" value={p.email} />
          </ActionForm>
        </section>
      )}

      {canChange(user) && (
        <section className="card">
          <h2>Kontaktdaten ändern</h2>
          <p className="note">
            Gilt für alle {d.recordCount} Datensätze und für künftige Rechnungen und E-Mails. Ausgestellte Rechnungen bleiben unverändert. Land und
            USt-IdNr. bestimmen die Steuer und bleiben, wie bestellt.
          </p>
          <ActionForm action={updateCustomerAction} submit="Speichern">
            <input type="hidden" name="customer_id" value={p.id} />
            <div className="field-row">
              <div className="field">
                <label htmlFor="first_name">Vorname</label>
                <input id="first_name" name="first_name" defaultValue={p.first_name ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="last_name">Nachname</label>
                <input id="last_name" name="last_name" defaultValue={p.last_name ?? ""} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="company_name">Firma</label>
              <input id="company_name" name="company_name" defaultValue={p.company_name ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="email">E-Mail</label>
              <input id="email" name="email" type="email" required defaultValue={p.email} />
            </div>
            <div className="field">
              <label htmlFor="street">Straße und Hausnummer</label>
              <input id="street" name="street" defaultValue={p.street ?? ""} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="postal_code">PLZ</label>
                <input id="postal_code" name="postal_code" defaultValue={p.postal_code ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="city">Ort</label>
                <input id="city" name="city" defaultValue={p.city ?? ""} />
              </div>
            </div>
          </ActionForm>
        </section>
      )}
    </>
  );
}
