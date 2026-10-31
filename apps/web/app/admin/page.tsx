import { canChange, canSeeAll, listOrders, openWork } from "@idf/db/admin";
import { checkRange, dashboard, presetRange, PRESETS, type Preset, type Range } from "@idf/db/dashboard";
import { pool } from "../../lib/db";
import { formatCents, todayBerlin } from "../../lib/format";
import { requireUser } from "../../lib/session";
import { resolveNoticeAction } from "./actions";
import { DashboardView } from "./dashboard-view";
import { OrderTable } from "./order-table";

const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

export default async function AdminHome(props: { searchParams: Promise<{ zeitraum?: string; von?: string; bis?: string }> }) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const today = todayBerlin();
  // Eigener Zeitraum (von/bis) vor Auswahl; Vorgabe: letzte 30 Tage wie in Thrivecart.
  const custom = sp.von && sp.bis ? checkRange({ from: sp.von, to: sp.bis }) : null;
  const active: Preset | null = custom ? null : sp.zeitraum && sp.zeitraum in PRESETS ? (sp.zeitraum as Preset) : "30";
  const range: Range = custom ?? presetRange(active!, today);
  const [orders, work, dash] = await Promise.all([
    listOrders(pool(), user, { limit: 10 }),
    canSeeAll(user) ? openWork(pool()) : null,
    dashboard(pool(), user, range, today),
  ]);

  return (
    <>
      <DashboardView d={dash} active={active} />
      {work && (
        <section className="card">
          <h1>Zu erledigen</h1>
          {work.notices.length === 0 && work.payments.length === 0 && work.charges.length === 0 && <p>Nichts offen.</p>}

          {work.notices.length > 0 && (
            <>
              <h2>Kündigungen und Widerrufe ({work.notices.length})</h2>
              {work.notices.map((n) => (
                <div key={n.id} className="work-item">
                  <p>
                    <strong>{n.kind === "kuendigung" ? `Kündigung (${n.cancellation_type === "ausserordentlich" ? "außerordentlich" : "ordentlich"})` : "Widerruf"}</strong> · eingegangen{" "}
                    {dateTime.format(n.received_at)}
                    <br />
                    {n.full_name} · {n.email}
                    <br />
                    Vertrag: {n.contract_reference}
                    {n.kind === "kuendigung" && <> · Ende: {n.requested_end ?? "nächstmöglich"}</>}
                    <br />
                    {n.order_id ? (
                      <a href={`/admin/bestellungen/${n.order_id}`}>Bestellung öffnen</a>
                    ) : n.thrivecart_order_id ? (
                      <span className="note">Thrivecart-Kauf {n.thrivecart_order_id}</span>
                    ) : (
                      <span className="note">Keinem Vertrag zugeordnet</span>
                    )}
                  </p>
                  {canChange(user) && (
                    <form action={resolveNoticeAction} className="inline-form">
                      <input type="hidden" name="notice_id" value={n.id} />
                      <input type="hidden" name="order_id" value={n.order_id ?? ""} />
                      <label htmlFor={`r-${n.id}`}>Was wurde gemacht?</label>
                      <input id={`r-${n.id}`} name="resolution" type="text" required placeholder="z. B. Abo zum 28.02. beendet, Bestätigung geschickt" />
                      <button type="submit">Erledigt</button>
                    </form>
                  )}
                </div>
              ))}
            </>
          )}

          {work.payments.length > 0 && (
            <>
              <h2>Zahlungen zur Prüfung ({work.payments.length})</h2>
              <table className="admin-table">
                <tbody>
                  {work.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateTime.format(p.received_at)}</td>
                      <td>{p.provider === "stripe" ? "Stripe" : "PayPal"}</td>
                      <td>{p.outcome_note}</td>
                      <td className="mono">{p.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {work.charges.length > 0 && (
            <>
              <h2>Einzug dreimal gescheitert ({work.charges.length})</h2>
              <table className="admin-table">
                <tbody>
                  {work.charges.map((c) => (
                    <tr key={`${c.order_id}-${c.seq}`}>
                      <td>
                        <a href={`/admin/bestellungen/${c.order_id}`}>Rate {c.seq}</a>
                      </td>
                      <td>fällig {c.due_date}</td>
                      <td>{formatCents(Number(c.gross_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h1>Neueste Bestellungen</h1>
        <OrderTable orders={orders} />
        <p>
          <a href="/admin/bestellungen">Alle Bestellungen</a>
        </p>
      </section>
    </>
  );
}

