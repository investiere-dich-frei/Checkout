import { MANUAL_MODEL_LABEL } from "@idf/core/manual-plan";
import { canCreateManual, countManualOrders, listManualOrders, MANUAL_STATUS_LABEL, type ManualStatus } from "@idf/db/manual-orders";
import { pool } from "../../../lib/db";
import { formatCents, formatDay, todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";

const TABS: { key: ManualStatus | "aktiv" | "alle"; label: string }[] = [
  { key: "aktiv", label: "Zu erledigen" },
  { key: "ueberfaellig", label: "Überfällig" },
  { key: "offen", label: "Offen" },
  { key: "teilbezahlt", label: "Teilbezahlt" },
  { key: "bezahlt", label: "Bezahlt" },
  { key: "rueckzahlung_offen", label: "Rückzahlung offen" },
  { key: "storniert", label: "Storniert" },
  { key: "alle", label: "Alle" },
];

const BADGE: Record<ManualStatus, string> = {
  offen: "badge",
  ueberfaellig: "badge badge-warn",
  teilbezahlt: "badge",
  bezahlt: "badge badge-ok",
  storniert: "badge",
  rueckzahlung_offen: "badge badge-warn",
};

export default async function ManualOrdersPage(props: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireUser();
  const { status, q } = await props.searchParams;
  const tab = TABS.find((t) => t.key === status)?.key ?? "aktiv";
  const today = todayBerlin();
  const [rows, counts] = await Promise.all([
    listManualOrders(pool(), user, { today, status: tab, search: q }),
    countManualOrders(pool(), user, today),
  ]);
  const countOf = (k: (typeof TABS)[number]["key"]) =>
    k === "alle"
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : k === "aktiv"
        ? counts.offen + counts.ueberfaellig + counts.teilbezahlt + counts.rueckzahlung_offen
        : counts[k];
  const link = (k: string) => `?${new URLSearchParams({ status: k, ...(q ? { q } : {}) })}`;

  return (
    <section className="card">
      <div className="card-head">
        <h1>Manuelle Bestellungen</h1>
        {canCreateManual(user) && (
          <a className="button-link" href="/admin/manuell/neu">
            Neue Bestellung per Rechnung
          </a>
        )}
      </div>
      <p className="note">
        Die Kundin bekommt zuerst eine Rechnung und zahlt per Überweisung. Zahlungseingänge, Storno und Rückzahlung werden hier verbucht.
      </p>
      <nav className="steps" aria-label="Status">
        {TABS.map((t) => (
          <a key={t.key} href={link(t.key)} aria-current={t.key === tab ? "page" : undefined} style={t.key === tab ? { fontWeight: 600 } : undefined}>
            {t.label} ({countOf(t.key)})
          </a>
        ))}
      </nav>
      <form className="inline-form" role="search">
        <input type="hidden" name="status" value={tab} />
        <label htmlFor="q">Suche nach Rechnungsnummer, Name, E-Mail oder Produkt</label>
        <input id="q" name="q" type="search" defaultValue={q ?? ""} />
        <button type="submit">Suchen</button>
      </form>
      {rows.length === 0 ? (
        <p>Keine Bestellungen in dieser Ansicht.</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Rechnung</th>
                <th>Kundin</th>
                <th>Produkt</th>
                <th>Betrag</th>
                <th>Bezahlt</th>
                <th>Nächste Zahlung</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orderId}>
                  <td>
                    <a href={`/admin/manuell/${r.orderId}`}>{r.invoiceNumber}</a>
                    <br />
                    <span className="note">{formatDay(r.issueDate)}</span>
                  </td>
                  <td>
                    {r.customerName}
                    <br />
                    <span className="note">{r.email}</span>
                  </td>
                  <td>
                    {r.product}
                    <br />
                    <span className="note">
                      {MANUAL_MODEL_LABEL[r.model]}
                      {r.seller && ` · ${r.seller}`}
                    </span>
                  </td>
                  <td>{formatCents(r.totalCents, r.currency)}</td>
                  <td>{formatCents(r.paidCents, r.currency)}</td>
                  <td>
                    {r.nextDue && r.status !== "storniert" && r.status !== "rueckzahlung_offen" ? (
                      <>
                        {formatCents(r.nextDueCents ?? 0, r.currency)}
                        <br />
                        <span className="note">bis {formatDay(r.nextDue)}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>
                    <span className={BADGE[r.status]}>{MANUAL_STATUS_LABEL[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
