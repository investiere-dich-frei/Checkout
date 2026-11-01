import { portalEmail, portalLegacySubscriptions, portalOrders, type PortalOrder } from "@idf/db/customer-portal";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents, formatDay } from "../../../lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kundenbereich – Investiere Dich Frei", robots: { index: false } };

const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });

const STATUS: Record<string, string> = { offen: "offen", bezahlt: "bezahlt", fehlgeschlagen: "fehlgeschlagen", erlassen: "entfällt (Pause)", storniert: "entfällt" };
const PAYMENT: Record<PortalOrder["payment"], string> = {
  stripe: "Karte bzw. gespeicherte Zahlungsart",
  paypal: "PayPal",
  paypal_abo: "PayPal-Abo (wird bei PayPal abgebucht)",
  ueberweisung: "Überweisung",
  keine: "noch keine Zahlungsart gespeichert",
};

export default async function PortalPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const email = await portalEmail(pool(), token);
  if (!email) redirect("/konto?abgelaufen=1");
  const [orders, legacy] = await Promise.all([portalOrders(pool(), email), portalLegacySubscriptions(pool(), email)]);

  return (
    <>
      <section className="card">
        <h1>Dein Kundenbereich</h1>
        <p className="note">{email}</p>
        {orders.length === 0 && <p>Zu dieser Adresse gibt es im neuen System noch keine Bestellungen.</p>}
        {orders.map((o) => (
          <div key={o.id} className="portal-order" style={{ marginTop: 24 }}>
            <h2>
              {o.product}
              {o.option ? ` – ${o.option}` : ""}
            </h2>
            <p className="note">
              Bestellt am {day.format(o.createdAt)}
              {o.status === "storniert" || o.status === "erstattet" ? ` · ${o.status}` : ""}
              {o.endsOn ? ` · gekündigt zum ${formatDay(o.endsOn)}` : ""}
              {o.installments.some((i) => i.status === "offen" || i.status === "fehlgeschlagen") ? ` · Zahlung: ${PAYMENT[o.payment]}` : ""}
            </p>
            <table className="summary-table">
              <tbody>
                {o.installments.map((i) => (
                  <tr key={i.seq}>
                    <td>
                      {formatDay(i.dueDate)} · {STATUS[i.status] ?? i.status}
                      {i.invoiceId && (
                        <>
                          {" · "}
                          <a href={`/bestellung/${o.id}/rechnung/${i.invoiceId}`}>Rechnung {i.invoiceNumber}</a>
                        </>
                      )}
                    </td>
                    <td>{formatCents(i.grossCents, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.installments.some((i) => i.status === "fehlgeschlagen") && (
              <p className="error">Eine Zahlung hat nicht geklappt. Bitte hinterlege eine neue Karte, dann ziehen wir sie gleich ein.</p>
            )}
            {o.canChangeCard && (
              <p>
                <a className="button" href={`/konto/${token}/karte/${o.id}`}>
                  Karte bzw. Zahlungsart ändern
                </a>
              </p>
            )}
            {o.payment === "paypal_abo" && <p className="note">Dein PayPal-Abo verwaltest du in deinem PayPal-Konto unter „Automatische Zahlungen“.</p>}
          </div>
        ))}
      </section>

      {legacy.length > 0 && (
        <section className="card">
          <h2>Noch über unser altes System</h2>
          <p className="note">Diese Abos und Raten laufen noch über Thrivecart weiter. Du musst nichts tun; Rechnungen dazu kommen wie bisher per E-Mail.</p>
          <ul>
            {legacy.map((l, i) => (
              <li key={i}>
                {l.product ?? "Abo"}
                {l.next_payment_at ? ` · nächste Zahlung ${day.format(l.next_payment_at)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Kündigen oder widerrufen</h2>
        <p>
          <a href="/vertraege-kuendigen">Verträge hier kündigen</a> · <a href="/vertrag-widerrufen">Vertrag widerrufen</a>
        </p>
        <p className="note">Der Link zu dieser Seite gilt einige Tage. Danach kannst du unter /konto einen neuen anfordern.</p>
      </section>
    </>
  );
}
