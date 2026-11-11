import { EMPLOYMENTS, type Employment } from "@idf/core/credit";
import { canChange, canSeeAll } from "@idf/db/admin";
import { getCreditSettings, listCreditChecks } from "@idf/db/credit";
import { CREDIT_TEXTS_VERSION } from "@idf/db/credit-texts";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatCents } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { ActionForm } from "../produkte/forms";
import { decideCheckAction, updateCreditSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
const RESULT: Record<string, string> = { gruen: "Grün", gelb: "Gelb", rot: "Rot" };
const euroInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }));

/** Ratenkauf: Prüfungen ansehen und entscheiden, Regeln einstellen (docs/ratenkauf.md). */
export default async function CreditChecksPage() {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const edit = canChange(user);
  const [settings, checks] = await Promise.all([getCreditSettings(pool()), listCreditChecks(pool())]);
  const open = checks.filter((c) => !c.decision && !c.order_id && (c.result === "gelb" || c.result === "rot"));

  return (
    <>
      <section className="card">
        <h1>Ratenprüfung</h1>
        <p className="note">
          Ratenzahlungen über 50 Tage sind seit 20.11.2026 ein Kredit. Vor dem Vertrag prüft der Fragebogen, ob die Raten zu den Finanzen der Kundin passen. Grün geht
          automatisch weiter, gelb prüft ihr hier innerhalb eines Werktags. Rot ist abgelehnt; verlangt die Kundin eine Prüfung durch einen Menschen, entscheidet ihr
          hier ebenfalls. Jede Prüfung und Entscheidung ist festgeschrieben.
        </p>
        <p>
          Ratenkauf ist <strong>{settings.enabled ? "eingeschaltet" : "ausgeschaltet"}</strong>. Rechtstexte: Fassung {CREDIT_TEXTS_VERSION}
          {CREDIT_TEXTS_VERSION.startsWith("entwurf") && " (Entwurf, vor dem Einschalten vom Anwalt prüfen lassen)"}.
        </p>
      </section>

      <section className="card">
        <h2>Offen ({open.length})</h2>
        {open.length === 0 && <p className="note">Nichts zu entscheiden.</p>}
        {open.map((c) => {
          const a = c.answers as { employment: Employment; netIncomeCents: number; housingCents: number; otherCreditsCents: number; dependents: number; paymentProblems: boolean };
          return (
            <div key={c.id} className="card">
              <h3>
                {c.customer.first_name} {c.customer.last_name} · {c.product} – {c.option_label} · <span className={c.result === "rot" ? "badge badge-warn" : "badge"}>{RESULT[c.result]}</span>
              </h3>
              <p className="note">
                {dateTime.format(c.created_at)} · {c.email} · Verfahren {c.method} ({c.rules_version})
              </p>
              <ul>
                <li>Beschäftigung: {EMPLOYMENTS[a.employment] ?? a.employment}</li>
                <li>Netto-Einkommen: {formatCents(a.netIncomeCents)} · Wohnen: {formatCents(a.housingCents)} · andere Raten: {formatCents(a.otherCreditsCents)}</li>
                <li>Mitversorgte Personen: {a.dependents} · Zahlungsprobleme: {a.paymentProblems ? "ja" : "nein"}</li>
                <li>
                  Monatsrate: {formatCents(Number(c.monthly_rate_cents))} · Kreditbetrag: {formatCents(Number(c.credit_cents))} · freies Einkommen:{" "}
                  {c.free_income_cents === null ? "–" : formatCents(Number(c.free_income_cents))}
                </li>
                {(c.reasons as string[]).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {edit && (
                <ActionForm action={decideCheckAction} submit="Entscheidung speichern" confirm="Entscheidung speichern? Sie lässt sich nicht ändern.">
                  <input type="hidden" name="check_id" value={c.id} />
                  <fieldset className="radio-row">
                    <label>
                      <input type="radio" name="decision" value="freigegeben" /> Freigeben
                    </label>
                    <label>
                      <input type="radio" name="decision" value="abgelehnt" /> Ablehnen
                    </label>
                  </fieldset>
                  <label>
                    Begründung (für den Nachweis; bei Ablehnung auch für die Erklärung an die Kundin)
                    <textarea name="note" rows={2} required />
                  </label>
                </ActionForm>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Alle Prüfungen (letzte 100)</h2>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Kundin</th>
              <th>Angebot</th>
              <th>Ergebnis</th>
              <th>Entscheidung</th>
              <th>Bestellung</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td>{dateTime.format(c.created_at)}</td>
                <td>{c.email}</td>
                <td>
                  {c.product} – {c.option_label}
                </td>
                <td>{RESULT[c.result]}</td>
                <td>{c.decision ? `${c.decision} (${c.decided_by}): ${c.note}` : "–"}</td>
                <td>{c.order_id ? <a href={`/admin/bestellungen/${c.order_id}`}>ansehen</a> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Regeln und Schalter</h2>
        <p className="note">
          Freies Einkommen = Netto − Wohnen − andere Raten − Lebenshaltung (Pauschale plus Zuschlag je mitversorgter Person). Grün, wenn die Monatsrate höchstens den
          eingestellten Anteil davon ausmacht; rot bei Zahlungsproblemen oder wenn die Rate nicht ins freie Einkommen passt; sonst gelb. Änderungen gelten nur für neue
          Prüfungen. Zuletzt geändert {dateTime.format(settings.updatedAt)} von {settings.updatedBy}.
        </p>
        <ActionForm action={updateCreditSettingsAction} submit="Speichern">
          <fieldset disabled={!edit} className="settings-grid">
            <label className="check">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Ratenkauf mit Kredit einschalten
            </label>
            <label>
              E-Mail für Widerruf und Rückfragen
              <input name="contact_email" defaultValue={settings.contactEmail} required />
            </label>
            <label>
              Telefon (steht in der Standardinformation)
              <input name="contact_phone" defaultValue={settings.contactPhone ?? ""} />
            </label>
            <label>
              Lebenshaltung ohne Wohnen, € je Monat
              <input name="living_cost" defaultValue={euroInput(settings.livingCostCents)} />
            </label>
            <label>
              Zuschlag je mitversorgter Person, €
              <input name="living_cost_dependent" defaultValue={euroInput(settings.livingCostPerDependentCents)} />
            </label>
            <label>
              Grün bis Anteil des freien Einkommens, %
              <input name="green_max_share" defaultValue={(settings.greenMaxShareBp / 100).toLocaleString("de-DE")} />
            </label>
            <label>
              Immer Prüfung durch das Team ab Kreditbetrag, € (leer = nie)
              <input name="manual_review_from" defaultValue={euroInput(settings.manualReviewFromCents)} />
            </label>
            <label>
              Auskunftei ab Kreditbetrag, € (leer = aus; noch nicht angebunden, solche Fälle werden gelb)
              <input name="bureau_from" defaultValue={euroInput(settings.bureauFromCents)} />
            </label>
          </fieldset>
        </ActionForm>
      </section>
    </>
  );
}
