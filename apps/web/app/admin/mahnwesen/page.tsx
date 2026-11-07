import { canChange, canSeeAll } from "@idf/db/admin";
import { MAX_ATTEMPTS, RETRY_AFTER_DAYS } from "@idf/db/billing";
import {
  CARD_HORIZON_DAYS,
  DUNNING_LINK_DAYS,
  dunningStats,
  OVERDUE_STATE_LABEL,
  overduePayments,
  REMINDER_DAYS_BEFORE,
  REMINDER_MIN_INTERVAL_MONTHS,
  type OverdueState,
} from "@idf/db/dunning";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents, formatDay, todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { chargeNowAction, sendPortalLinkAction } from "../kunden/actions";
import { ActionForm } from "../produkte/forms";

const NOTICE_LABEL: Record<string, string> = {
  erinnerung: "Erinnerung vor Abbuchung",
  fehlgeschlagen: "Zahlung fehlgeschlagen",
  letzte_mahnung: "Letzte Mahnung",
  karte_ablauf: "Karte läuft ab",
};
const BADGE: Record<OverdueState, string> = {
  naechster_einzug: "badge",
  erneuter_versuch: "badge",
  laeuft: "badge",
  aufgegeben: "badge badge-warn",
  ohne_zahlungsart: "badge badge-warn",
  paypal_abo: "badge",
  ueberweisung: "badge",
};
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
const int = new Intl.NumberFormat("de-DE");
/** Wer handeln muss, steht oben. */
const ORDER: OverdueState[] = ["aufgegeben", "ohne_zahlungsart", "erneuter_versuch", "naechster_einzug", "laeuft", "paypal_abo", "ueberweisung"];

export default async function DunningPage(props: { searchParams: Promise<{ lage?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { lage } = await props.searchParams;
  const today = todayBerlin();
  const [all, stats] = await Promise.all([overduePayments(pool(), today), dunningStats(pool(), today)]);
  const filter = ORDER.find((s) => s === lage) ?? null;
  const rows = [...(filter ? all.filter((r) => r.state === filter) : all)].sort(
    (a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.dueDate.localeCompare(b.dueDate),
  );
  const count = (s: OverdueState) => all.filter((r) => r.state === s).length;
  const sum = all.reduce((a, r) => a + r.grossCents, 0);
  const rate = stats.failed ? Math.round((stats.recovered / stats.failed) * 100) : null;
  const notices = Object.values(stats.notices).reduce((a, b) => a + b, 0);
  const retry = RETRY_AFTER_DAYS.map((d, i) => `${i + 2}. Versuch ${d} Tage nach dem ${i + 1}.`).join(", ");

  return (
    <>
      <section className="card">
        <h1>Mahnwesen</h1>
        <p className="note">
          Überfällige Raten und Abozahlungen. Der Einzug läuft jeden Morgen. Nach einer Ablehnung bucht er bis zu {MAX_ATTEMPTS}-mal ab ({retry}) und
          schickt nach jedem Fehlschlag eine E-Mail mit Link zum Kundenbereich. Dort hinterlegt die Kundin eine neue Karte, die offene Rate wird dann
          sofort abgebucht. Gebühren oder Zinsen berechnen wir nicht.
        </p>
        <div className="dash-tiles">
          <div className="dash-tile">
            <span className="dash-label">Überfällig jetzt</span>
            <span className="dash-value">{int.format(all.length)}</span>
            <span className="dash-sub">{formatCents(sum)}</span>
          </div>
          <a className="dash-tile" href="?lage=aufgegeben">
            <span className="dash-label">Bitte nachfassen</span>
            <span className="dash-value">{int.format(count("aufgegeben") + count("ohne_zahlungsart"))}</span>
            <span className="dash-sub">keine automatischen Versuche mehr oder keine Zahlungsart</span>
          </a>
          <div className="dash-tile">
            <span className="dash-label">Abgelehnte Zahlungen (12 Monate)</span>
            <span className="dash-value">{int.format(stats.failed)}</span>
            <span className="dash-sub">{formatCents(stats.failedCents)}</span>
          </div>
          <div className="dash-tile">
            <span className="dash-label">Davon gerettet</span>
            <span className="dash-value">{rate === null ? "–" : `${rate} %`}</span>
            <span className="dash-sub">
              {int.format(stats.recovered)} bezahlt · {formatCents(stats.recoveredCents)}
            </span>
          </div>
          <div className="dash-tile">
            <span className="dash-label">Noch offen / entfallen</span>
            <span className="dash-value">
              {int.format(stats.open)} / {int.format(stats.dropped)}
            </span>
            <span className="dash-sub">
              {formatCents(stats.openCents)} / {formatCents(stats.droppedCents)}
            </span>
          </div>
          <div className="dash-tile">
            <span className="dash-label">E-Mails verschickt (12 Monate)</span>
            <span className="dash-value">{int.format(notices)}</span>
            <span className="dash-sub">
              {Object.entries(stats.notices)
                .map(([k, n]) => `${NOTICE_LABEL[k] ?? k}: ${int.format(n)}`)
                .join(" · ") || "noch keine"}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Überfällige Zahlungen</h2>
        <p className="filter-actions">
          <a href="/admin/mahnwesen" aria-current={filter ? undefined : "page"}>
            Alle ({all.length})
          </a>
          {ORDER.filter((s) => s !== "ueberweisung" && count(s) > 0).map((s) => (
            <a key={s} href={`?lage=${s}`} aria-current={filter === s ? "page" : undefined}>
              {OVERDUE_STATE_LABEL[s]} ({count(s)})
            </a>
          ))}
        </p>
        {rows.length === 0 ? (
          <p className="note">Keine überfälligen Zahlungen.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fällig</th>
                  <th>Kundin</th>
                  <th>Angebot</th>
                  <th>Betrag</th>
                  <th>Lage</th>
                  <th>Letzte E-Mail</th>
                  {canChange(user) && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.installmentId}>
                    <td>
                      <a href={`/admin/bestellungen/${r.orderId}`}>{formatDay(r.dueDate)}</a>
                      <br />
                      <span className="note">{r.daysOverdue === 0 ? "heute" : `seit ${r.daysOverdue} Tag${r.daysOverdue === 1 ? "" : "en"}`}</span>
                    </td>
                    <td>
                      <a href={`/admin/kunden/${r.customerId}`}>{r.customerName}</a>
                      <br />
                      <span className="note">{r.email}</span>
                    </td>
                    <td>
                      {r.product}
                      <br />
                      <span className="note">
                        {r.isAbo ? `Abozahlung ${r.seq}` : `Rate ${r.seq} von ${r.installments}`} · {r.option}
                      </span>
                    </td>
                    <td>{formatCents(r.grossCents, r.currency)}</td>
                    <td>
                      <span className={BADGE[r.state]}>{OVERDUE_STATE_LABEL[r.state]}</span>
                      <br />
                      <span className="note">
                        {r.attempts > 0 ? `${r.attempts} von ${MAX_ATTEMPTS} Versuchen` : "noch kein Versuch"}
                        {r.lastErrorCode && ` · ${r.lastErrorCode}`}
                        {r.nextTry && ` · nächster Versuch ${r.nextTry <= today ? "beim nächsten Einzug" : formatDay(r.nextTry)}`}
                      </span>
                    </td>
                    <td>
                      {r.lastNotice ? (
                        <>
                          {NOTICE_LABEL[r.lastNotice.kind] ?? r.lastNotice.kind}
                          <br />
                          <span className="note">{dateTime.format(r.lastNotice.at)}</span>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                    {canChange(user) && (
                      <td>
                        {(r.state === "erneuter_versuch" || r.state === "aufgegeben" || r.state === "naechster_einzug") && (
                          <ActionForm
                            action={chargeNowAction}
                            className="inline-form"
                            submit="Jetzt abbuchen"
                            confirm={`${formatCents(r.grossCents, r.currency)} jetzt von der gespeicherten Zahlungsart abbuchen?`}
                          >
                            <input type="hidden" name="order_id" value={r.orderId} />
                            <input type="hidden" name="installment_id" value={r.installmentId} />
                          </ActionForm>
                        )}
                        {r.state !== "paypal_abo" && r.state !== "laeuft" && (
                          <ActionForm action={sendPortalLinkAction} className="inline-form" submit="Link zum Kundenbereich senden">
                            <input type="hidden" name="email" value={r.email} />
                          </ActionForm>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          Überweisungen aus manuellen Bestellungen stehen unter <a href="/admin/manuell?status=ueberfaellig">Manuelle Bestellungen → Überfällig</a>.
        </p>
      </section>

      <section className="card">
        <h2>Welche E-Mails rausgehen</h2>
        <ul>
          <li>
            <strong>Erinnerung vor Abbuchung:</strong> {REMINDER_DAYS_BEFORE} Tage vorher, nur bei Abständen ab {REMINDER_MIN_INTERVAL_MONTHS} Monaten
            (vierteljährlich, jährlich). Bei monatlichen Zahlungen wäre das lästig.
          </li>
          <li>
            <strong>Karte läuft ab:</strong> wenn die gespeicherte Karte vor der nächsten Abbuchung (in den nächsten {CARD_HORIZON_DAYS} Tagen) abläuft,
            einmal je Karte.
          </li>
          <li>
            <strong>Zahlung fehlgeschlagen:</strong> nach jedem abgelehnten Versuch, mit dem Termin des nächsten Versuchs. Ohne hinterlegte Zahlungsart
            kommt die Bitte, eine Karte zu hinterlegen.
          </li>
          <li>
            <strong>Letzte Mahnung:</strong> nach dem {MAX_ATTEMPTS}. abgelehnten Versuch. Danach bucht die Kasse diese Rate nicht mehr selbst ab;
            Zugang und Abo bleiben bestehen, bis jemand hier entscheidet.
          </li>
        </ul>
        <p className="note">Alle E-Mails kommen von buchhaltung@ und enthalten einen persönlichen Link zum Kundenbereich ({DUNNING_LINK_DAYS} Tage gültig).</p>
      </section>
    </>
  );
}
