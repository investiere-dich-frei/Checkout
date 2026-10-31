import type { Dashboard, Preset } from "@idf/db/dashboard";
import { PRESETS } from "@idf/db/dashboard";
import { COUNTRIES } from "../../lib/countries";
import { formatCents, formatDay } from "../../lib/format";

const COUNTRY_NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]));
const MONTH = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit", timeZone: "UTC" });
const int = new Intl.NumberFormat("de-DE");

/** Veränderung zum Vorzeitraum, z. B. „+12 %“. Ohne Vorwert keine Angabe. */
function change(now: number, before: number): { text: string; up: boolean } | null {
  if (before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct} %`, up: pct >= 0 };
}

function Tile(props: { label: string; value: string; sub?: string; now?: number; before?: number; invert?: boolean; href?: string }) {
  const c = props.now !== undefined && props.before !== undefined ? change(props.now, props.before) : null;
  // Bei Erstattungen und Fehlzahlungen ist weniger besser.
  const good = c ? (props.invert ? !c.up : c.up) : true;
  const body = (
    <>
      <span className="dash-label">{props.label}</span>
      <span className="dash-value">{props.value}</span>
      {(props.sub || c) && (
        <span className="dash-sub">
          {c && (
            <span className={good ? "dash-up" : "dash-down"}>
              {c.text} <span className="dash-vs">zum Vorzeitraum</span>
            </span>
          )}
          {c && props.sub && " · "}
          {props.sub}
        </span>
      )}
    </>
  );
  return props.href ? (
    <a className="dash-tile" href={props.href}>
      {body}
    </a>
  ) : (
    <div className="dash-tile">{body}</div>
  );
}

/** Umsatz je Tag bzw. Monat als Säulen; Werte stehen zusätzlich in der Tabelle darunter. */
function RevenueChart({ d }: { d: Dashboard }) {
  const W = 720;
  const H = 200;
  const pad = { top: 12, bottom: 24, left: 4, right: 4 };
  const max = Math.max(1, ...d.series.map((s) => s.revenueCents));
  const n = d.series.length;
  const slot = (W - pad.left - pad.right) / n;
  const bw = Math.max(1, Math.min(32, slot - 2));
  const plotH = H - pad.top - pad.bottom;
  const label = (b: string) => (d.bucket === "monat" ? MONTH.format(new Date(`${b}T00:00:00Z`)) : formatDay(b).slice(0, 6));
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <figure className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Umsatz je ${d.bucket === "monat" ? "Monat" : "Tag"}`} preserveAspectRatio="none">
        <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} className="dash-axis" />
        {d.series.map((s, i) => {
          const h = (s.revenueCents / max) * plotH;
          const x = pad.left + i * slot + (slot - bw) / 2;
          const y = H - pad.bottom - h;
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={s.bucket} className="dash-bar">
              {/* Trefferfläche über die ganze Höhe, damit der Hinweis auch bei kleinen Säulen erscheint. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent">
                <title>
                  {`${label(s.bucket)}: ${formatCents(s.revenueCents)} Umsatz${s.refundsCents ? `, ${formatCents(s.refundsCents)} erstattet` : ""}`}
                </title>
              </rect>
              {h > 0 && (
                <path
                  d={`M${x},${H - pad.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - pad.bottom} Z`}
                  pointerEvents="none"
                />
              )}
              {i % every === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="dash-tick">
                  {label(s.bucket)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="note">
        Höchster Wert {formatCents(max === 1 ? 0 : max)} · Maus auf eine Säule zeigt den Betrag.
      </figcaption>
      <details>
        <summary>Als Tabelle anzeigen</summary>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{d.bucket === "monat" ? "Monat" : "Tag"}</th>
                <th>Umsatz</th>
                <th>Erstattet</th>
              </tr>
            </thead>
            <tbody>
              {d.series
                .filter((s) => s.revenueCents || s.refundsCents)
                .map((s) => (
                  <tr key={s.bucket}>
                    <td>{d.bucket === "monat" ? label(s.bucket) : formatDay(s.bucket)}</td>
                    <td>{formatCents(s.revenueCents)}</td>
                    <td>{s.refundsCents ? formatCents(s.refundsCents) : "–"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function RangePicker(props: { active: Preset | null; from: string; to: string }) {
  return (
    <div className="dash-ranges">
      <nav aria-label="Zeitraum" className="dash-presets">
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <a key={p} href={`/admin?zeitraum=${p}`} aria-current={props.active === p ? "true" : undefined}>
            {PRESETS[p]}
          </a>
        ))}
      </nav>
      <form className="dash-custom" method="get" action="/admin">
        <label htmlFor="von">Von</label>
        <input id="von" name="von" type="date" defaultValue={props.from} required />
        <label htmlFor="bis">Bis</label>
        <input id="bis" name="bis" type="date" defaultValue={props.to} required />
        <button type="submit">Anzeigen</button>
      </form>
    </div>
  );
}

export function DashboardView({ d, active }: { d: Dashboard; active: Preset | null }) {
  const c = d.current;
  const b = d.before;
  const net = c.revenueCents - c.refundsCents;
  const avg = c.newSales ? Math.round(c.newSalesCents / c.newSales) : 0;
  const avgBefore = b.newSales ? Math.round(b.newSalesCents / b.newSales) : 0;
  const totalCountry = d.byCountry.reduce((t, x) => t + x.revenueCents, 0) || 1;

  return (
    <section className="card dash">
      <div className="card-head">
        <h1>Dashboard</h1>
        <span className="note">
          {formatDay(d.range.from)} – {formatDay(d.range.to)}
        </span>
      </div>
      <RangePicker active={active} from={d.range.from} to={d.range.to} />

      <div className="dash-tiles">
        <Tile label="Umsatz (brutto)" value={formatCents(c.revenueCents)} sub={`netto ${formatCents(c.revenueNetCents)}`} now={c.revenueCents} before={b.revenueCents} />
        <Tile label="Umsatz nach Erstattungen" value={formatCents(net)} now={net} before={b.revenueCents - b.refundsCents} />
        <Tile label="Neue Verkäufe" value={int.format(c.newSales)} sub={formatCents(c.newSalesCents)} now={c.newSales} before={b.newSales} href="/admin/bestellungen" />
        <Tile label="Ø Wert je Verkauf" value={formatCents(avg)} sub="erste Zahlung" now={avg} before={avgBefore} />
        <Tile label="Folgezahlungen (Raten, Abos)" value={int.format(c.rebills)} sub={formatCents(c.rebillsCents)} now={c.rebillsCents} before={b.rebillsCents} />
        <Tile label="Erstattungen" value={formatCents(c.refundsCents)} sub={`${int.format(c.refunds)} Stornorechnung${c.refunds === 1 ? "" : "en"}`} now={c.refundsCents} before={b.refundsCents} invert />
        <Tile label="Fehlgeschlagene Einzüge" value={int.format(c.failedPayments)} sub={formatCents(c.failedPaymentsCents)} now={c.failedPayments} before={b.failedPayments} invert />
        <Tile label="Begonnen, nicht bezahlt" value={int.format(c.startedUnpaid)} sub="Bestellungen ohne Zahlung" />
        <Tile label="Mit Gutschein" value={int.format(c.couponOrders)} sub={`${formatCents(c.couponDiscountCents)} Rabatt`} href="/admin/gutscheine" />
      </div>

      <h2>Umsatz je {d.bucket === "monat" ? "Monat" : "Tag"}</h2>
      <RevenueChart d={d} />

      <h2>Stand heute</h2>
      <div className="dash-tiles">
        <Tile label="Laufende Abos" value={int.format(d.now.activeSubscriptions)} sub={`${formatCents(d.now.mrrCents)} pro Monat`} />
        <Tile label="Laufende Ratenpläne" value={int.format(d.now.activePlans)} sub={`${formatCents(d.now.plansOutstandingCents)} noch offen`} />
        <Tile label="Überfällige Zahlungen" value={int.format(d.now.overdue)} sub={formatCents(d.now.overdueCents)} />
      </div>

      <div className="dash-columns">
        <div>
          <h2>Top-Produkte</h2>
          {d.topProducts.length === 0 ? (
            <p className="note">Keine Umsätze im Zeitraum.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Produkt</th>
                  <th>Verkäufe</th>
                  <th>Umsatz</th>
                </tr>
              </thead>
              <tbody>
                {d.topProducts.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{int.format(p.sales)}</td>
                    <td>{formatCents(p.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h2>Nach Land</h2>
          {d.byCountry.length === 0 ? (
            <p className="note">Keine Umsätze im Zeitraum.</p>
          ) : (
            <table className="admin-table">
              <tbody>
                {d.byCountry.map((x) => (
                  <tr key={x.country}>
                    <td>{COUNTRY_NAME.get(x.country) ?? x.country}</td>
                    <td>{formatCents(x.revenueCents)}</td>
                    <td className="note">{Math.round((x.revenueCents / totalCountry) * 100)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.bySeller && d.bySeller.length > 0 && (
            <>
              <h2>Nach Vertrieb</h2>
              <table className="admin-table">
                <tbody>
                  {d.bySeller.map((x) => (
                    <tr key={x.seller}>
                      <td>{x.seller}</td>
                      <td>{int.format(x.sales)} Verkäufe</td>
                      <td>{formatCents(x.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {d.legacy && d.legacy.invoices > 0 && (
        <p className="note">
          Zusätzlich in Thrivecart im selben Zeitraum (Altdaten bis zur Übernahme): {int.format(d.legacy.invoices)} Rechnungen, {formatCents(d.legacy.revenueCents)}.
        </p>
      )}
      <p className="note">
        Umsatz = ausgestellte Rechnungen nach Rechnungsdatum, Erstattungen = Stornorechnungen. Vergleich mit {formatDay(d.previous.from)} – {formatDay(d.previous.to)}.
      </p>
    </section>
  );
}
