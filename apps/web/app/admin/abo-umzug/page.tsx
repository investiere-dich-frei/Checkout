import { canChange, canSeeAll } from "@idf/db/admin";
import { takeoverOverview, type TakeoverRoute } from "@idf/db/takeover";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { ActionForm } from "../produkte/forms";
import { markStoppedAction, takeoverAction } from "./actions";

const day = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" });

const ROUTE: Record<TakeoverRoute, { title: string; how: string }> = {
  paypal: { title: "PayPal", how: "Bleibt bei PayPal. Der neue Checkout übernimmt nur die Abrechnung, die Kundin muss nichts tun." },
  stripe: { title: "Stripe (eigenes Konto)", how: "Karte liegt schon im eigenen Stripe-Konto. Umzug ohne Zutun der Kundin." },
  thrivepay: { title: "ThrivePay", how: "Stripe-Abo im eigenen Stripe-Konto, von Thrivecart gesteuert. Umzug ohne Zutun der Kundin." },
  unbekannt: { title: "Unbekannt", how: "Zahlungsweg nicht erkannt, einzeln ansehen." },
};

const STATUS: Record<string, string> = { active: "läuft", paused: "pausiert", overdue: "überfällig", trial: "Probezeit" };

export default async function TakeoverPage(props: { searchParams: Promise<{ weg?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { weg } = await props.searchParams;
  const route = weg && weg in ROUTE ? (weg as TakeoverRoute) : undefined;
  const d = (await takeoverOverview(pool(), user, { route }))!;
  const total = d.summary.reduce((t, s) => t + s.count, 0);

  return (
    <>
      <section className="card">
        <h1>Abo-Umzug aus Thrivecart</h1>
        <p className="note">
          Stand der Altdaten. {total} Abos und Ratenpläne laufen über Thrivecart, {d.summary.reduce((t, s) => t + s.takenOver, 0)} davon sind schon übernommen.
        </p>
        <p className="note">
          „Übernehmen“ legt eine Bestellung im neuen System an, die mit der nächsten Zahlung beginnt. Bei Stripe merkt es die Karte und kündigt das
          Stripe-Abo zum Ende der laufenden Periode. PayPal-Abos buchen weiter bei PayPal ab; der neue Checkout verbucht die Zahlungen und stellt die
          Rechnungen. Danach in Thrivecart die Abrechnung beenden, ohne das Abo bei Stripe oder PayPal zu kündigen (bei PayPal nie „Cancel“), und hier
          abhaken.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Zahlungsweg</th>
                <th>Laufend</th>
                <th>Davon pausiert</th>
                <th>Läuft bald aus (≤ 3 Raten)</th>
                <th>Ohne Abo-ID</th>
                <th>Ohne Produkt</th>
                <th>Umzug</th>
              </tr>
            </thead>
            <tbody>
              {d.summary
                .filter((s) => s.count > 0)
                .map((s) => (
                  <tr key={s.route}>
                    <td>
                      <a href={`?weg=${s.route}`}>{ROUTE[s.route].title}</a>
                    </td>
                    <td>{s.count}</td>
                    <td>{s.paused}</td>
                    <td>{s.endingSoon}</td>
                    <td>{s.withoutRef}</td>
                    <td>{s.withoutProduct}</td>
                    <td className="note">{ROUTE[s.route].how}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>{route ? ROUTE[route].title : "Alle"} nach nächster Zahlung</h2>
        {route && (
          <p>
            <a href="/admin/abo-umzug">Alle anzeigen</a>
          </p>
        )}
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nächste Zahlung</th>
                <th>Kundin</th>
                <th>Produkt</th>
                <th>Betrag</th>
                <th>Zahlungen</th>
                <th>Weg</th>
                <th>Status</th>
                <th>Umzug</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.subscriptionId}>
                  <td>{r.nextPaymentAt ? day.format(r.nextPaymentAt) : "–"}</td>
                  <td>{r.customerId ? <a href={`/admin/kunden/${r.customerId}`}>{r.email}</a> : r.email}</td>
                  <td>
                    {r.product ?? "–"}
                    {!r.productMapped && <span className="badge badge-warn">nicht zugeordnet</span>}
                  </td>
                  <td>
                    {r.amountCents !== null ? formatCents(r.amountCents, r.currency) : "–"} {r.frequency ?? ""}
                  </td>
                  <td>
                    {r.paymentsMade ?? 0} gezahlt
                    {r.paymentsRemaining ? `, ${r.paymentsRemaining} offen` : ""}
                  </td>
                  <td>{ROUTE[r.route].title}</td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>
                    {r.takenOverOrderId ? (
                      <>
                        <a href={`/admin/bestellungen/${r.takenOverOrderId}`}>übernommen</a>
                        {r.thrivecartStopped ? (
                          <span className="badge">Thrivecart beendet</span>
                        ) : (
                          canChange(user) && (
                            <ActionForm action={markStoppedAction} className="inline-form" submit="In Thrivecart beendet">
                              <input type="hidden" name="order_id" value={r.takenOverOrderId} />
                            </ActionForm>
                          )
                        )}
                      </>
                    ) : (
                      canChange(user) &&
                      r.route !== "unbekannt" &&
                      (r.status === "active" || r.status === "trial") && (
                        <ActionForm
                          action={takeoverAction}
                          className="inline-form"
                          submit="Übernehmen"
                          confirm={
                            r.route === "paypal"
                              ? `Abo von ${r.email} übernehmen? Es bucht weiter bei PayPal ab, die Rechnungen stellt ab der nächsten Zahlung der neue Checkout.`
                              : `Abo von ${r.email} übernehmen? Das Stripe-Abo wird zum Ende der Periode gekündigt, danach bucht der neue Checkout ab.`
                          }
                        >
                          <input type="hidden" name="subscription_id" value={r.subscriptionId} />
                          <input type="hidden" name="route" value={r.route} />
                          <label>
                            <input type="checkbox" name="vat_id_verified" /> USt-IdNr. geprüft
                          </label>
                        </ActionForm>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
