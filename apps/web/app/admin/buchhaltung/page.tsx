import { AccountingError, taxReport, type TaxReportRow } from "@idf/db/accounting";
import { canSeeAll } from "@idf/db/admin";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents, formatRate, todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Vorschläge: Vormonat, laufendes und voriges Quartal, laufendes Jahr. */
function presets(today: string) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthStart = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm - 1, 1)));
  const monthEnd = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 0)));
  const q = Math.floor((m - 1) / 3);
  const prevQ = q === 0 ? { y: y - 1, q: 3 } : { y, q: q - 1 };
  return [
    { label: "Vormonat", from: monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), to: monthEnd(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1) },
    { label: `Q${prevQ.q + 1} ${prevQ.y}`, from: monthStart(prevQ.y, prevQ.q * 3 + 1), to: monthEnd(prevQ.y, prevQ.q * 3 + 3) },
    { label: `Q${q + 1} ${y} (laufend)`, from: monthStart(y, q * 3 + 1), to: today },
    { label: `${y} (laufend)`, from: `${y}-01-01`, to: today },
  ];
}

export default async function AccountingPage(props: { searchParams: Promise<{ von?: string; bis?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const today = todayBerlin();
  const p = presets(today);
  const sp = await props.searchParams;
  const period = { from: sp.von ?? p[0]!.from, to: sp.bis ?? p[0]!.to };
  let rows: TaxReportRow[] = [];
  let error: string | null = null;
  try {
    rows = await taxReport(pool(), user, period);
  } catch (err) {
    if (!(err instanceof AccountingError)) throw err;
    error = err.message;
  }
  const qs = `von=${encodeURIComponent(period.from)}&bis=${encodeURIComponent(period.to)}`;
  const byCurrency = (r: TaxReportRow[]) =>
    Object.entries(
      r.reduce<Record<string, { net: number; tax: number; gross: number }>>((t, x) => {
        const c = (t[x.currency] ??= { net: 0, tax: 0, gross: 0 });
        c.net += x.netCents;
        c.tax += x.taxCents;
        c.gross += x.grossCents;
        return t;
      }, {}),
    );
  const oss = rows.filter((r) => r.oss);

  return (
    <>
      <section className="card">
        <h1>Buchhaltung</h1>
        <p className="note">
          Ausgestellte Rechnungen im Zeitraum (Rechnungsdatum), mit dem Stand bei Ausstellung. Stornorechnungen zählen negativ im Monat ihrer
          Ausstellung. Alt-Rechnungen aus Thrivecart sind nicht enthalten.
        </p>
        <form className="inline-form" method="get">
          <label htmlFor="von">Von</label>
          <input id="von" name="von" type="date" defaultValue={period.from} required />
          <label htmlFor="bis">Bis</label>
          <input id="bis" name="bis" type="date" defaultValue={period.to} required />
          <button type="submit">Anzeigen</button>
        </form>
        <p>
          {p.map((x, i) => (
            <span key={x.label}>
              {i > 0 && " · "}
              <a href={`?von=${x.from}&bis=${x.to}`}>{x.label}</a>
            </span>
          ))}
        </p>
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <p>
            <a className="button" href={`/admin/buchhaltung/export?art=rechnungen&${qs}`}>Rechnungsliste (CSV)</a>{" "}
            <a className="button" href={`/admin/buchhaltung/export?art=steuer&${qs}`}>Steuerbericht (CSV)</a>{" "}
            <a className="button" href={`/admin/buchhaltung/export?art=pdf&${qs}`}>Alle Rechnungs-PDFs (ZIP)</a>
          </p>
        )}
      </section>

      {!error && (
        <section className="card">
          <h2>Steuerbericht je Land und Satz</h2>
          {rows.length === 0 ? (
            <p>Keine Rechnungen im Zeitraum.</p>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Land</th>
                    <th>Satz</th>
                    <th>Kundenart</th>
                    <th>Hinweis</th>
                    <th>Rechnungen</th>
                    <th>Netto</th>
                    <th>USt</th>
                    <th>Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={[r.country, r.taxRateBp, r.taxNote, r.business, r.currency].join("|")}>
                      <td>
                        {r.country}
                        {r.oss && <span className="badge">OSS</span>}
                      </td>
                      <td>{formatRate(r.taxRateBp)}</td>
                      <td>{r.business ? "Unternehmen" : "Privat"}</td>
                      <td className="note">{r.taxNote ?? ""}</td>
                      <td>{r.invoices}</td>
                      <td>{formatCents(r.netCents, r.currency)}</td>
                      <td>{formatCents(r.taxCents, r.currency)}</td>
                      <td>{formatCents(r.grossCents, r.currency)}</td>
                    </tr>
                  ))}
                  {byCurrency(rows).map(([cur, t]) => (
                    <tr key={cur}>
                      <th colSpan={5}>Summe {cur}</th>
                      <th>{formatCents(t.net, cur)}</th>
                      <th>{formatCents(t.tax, cur)}</th>
                      <th>{formatCents(t.gross, cur)}</th>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {oss.length > 0 && (
            <p className="note">
              OSS-Meldung (EU-Ausland, Privatkundinnen): Umsatzsteuer{" "}
              {byCurrency(oss)
                .map(([cur, t]) => formatCents(t.tax, cur))
                .join(", ")}{" "}
              auf Netto{" "}
              {byCurrency(oss)
                .map(([cur, t]) => formatCents(t.net, cur))
                .join(", ")}
              . Die Meldung selbst geht über das BZSt-Portal.
            </p>
          )}
        </section>
      )}
    </>
  );
}
