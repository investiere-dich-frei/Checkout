import { canChange, canSeeAll } from "@idf/db/admin";
import { LEGAL_KINDS, legalVersions, listCompanySettings, statutoryRates } from "@idf/db/settings";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { formatRate, todayBerlin } from "../../../lib/format";
import { requireUser } from "../../../lib/session";
import { ActionForm } from "../produkte/forms";
import { addLegalVersionAction, updateCompanyAction } from "./actions";

const KIND_LABEL: Record<string, string> = { agb: "AGB", datenschutz: "Datenschutzerklärung", widerruf: "Widerrufsbelehrung" };
const STATE_LABEL: Record<string, string> = { gilt: "gilt", geplant: "geplant", abgeloest: "abgelöst" };
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
const pct = (bp: number | null) => (bp === null ? "" : (bp / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }));

export default async function SettingsPage() {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const edit = canChange(user);
  const [companies, versions] = await Promise.all([listCompanySettings(pool()), legalVersions(pool())]);
  const today = todayBerlin();
  const field = (name: string, label: string, value: string | null, opts: { required?: boolean; hint?: string } = {}) => (
    <label>
      {label}
      <input name={name} defaultValue={value ?? ""} required={opts.required} disabled={!edit} />
      {opts.hint && <span className="note">{opts.hint}</span>}
    </label>
  );

  return (
    <>
      <section className="card">
        <h1>Einstellungen</h1>
        <p className="note">
          Änderungen gelten ab sofort für neue Rechnungen und Bestellungen. Ausgestellte Rechnungen behalten ihre Firmendaten, abgeschlossene Bestellungen
          ihre Rechtstexte. Jede Änderung steht mit Person und Zeit im Audit-Log.
        </p>
      </section>

      {companies.map((c) => (
        <section className="card" key={c.id}>
          <h2>Firmendaten: {c.legalName}</h2>
          <p className="note">
            Rechnungsnummern: {c.invoicePrefix ?? "–"}
            {c.invoiceNextValue ?? ""} ist die nächste (Nummernkreis lässt sich nicht ändern). Zahlungen: {c.paymentsMode === "test" ? "Testbetrieb" : "Live"}{" "}
            (Umstellung nur über den Server, nach Absprache).
          </p>
          <ActionForm action={updateCompanyAction} submit="Firmendaten speichern">
            <input type="hidden" name="company_id" value={c.id} />
            <fieldset disabled={!edit} className="settings-grid">
              {field("legal_name", "Firmenname", c.legalName, { required: true })}
              {field("street", "Straße und Hausnummer", c.street, { required: true })}
              {field("postal_code", "PLZ", c.postalCode, { required: true })}
              {field("city", "Ort", c.city, { required: true })}
              {field("country", "Land (Kürzel)", c.country, { required: true })}
              {field("vat_id", "USt-IdNr.", c.vatId)}
              {field("tax_number", "Steuernummer", c.taxNumber)}
              {field("register_info", "Handelsregister und Geschäftsführung", c.registerInfo)}
              {field("bank_name", "Bank", c.bankName, { hint: "Für Rechnungen per Überweisung" })}
              {field("iban", "IBAN", c.iban)}
              {field("bic", "BIC", c.bic)}
              {field("ch_vat_rate", "MWST Schweiz in %", pct(c.chVatRateBp), { hint: "Leer = kein Verkauf in die Schweiz" })}
            </fieldset>
          </ActionForm>
        </section>
      ))}

      <section className="card">
        <h2>Steuersätze</h2>
        <p>
          {statutoryRates()
            .map((r) => `${r.country} ${formatRate(r.rateBp)}`)
            .join(" · ")}{" "}
          · übrige EU-Länder: jeweiliger Normalsatz · Schweiz: siehe Firmendaten.
        </p>
        <p className="note">
          Die gesetzlichen Sätze stehen fest im Programm und werden bei einer Gesetzesänderung per Update angepasst. Ob ein Produkt nach § 4 Nr. 21 UStG
          steuerfrei ist, steht beim Produkt (Verwaltung → Produkte).
        </p>
      </section>

      <section className="card">
        <h2>Rechtstexte</h2>
        <p className="note">
          Texte werden nie überschrieben. Eine neue Fassung gilt ab dem gewählten Tag (heute = sofort) für neue Bestellungen. Bitte nur den vom Anwalt geprüften
          Wortlaut einfügen.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Text</th>
                <th>Fassung</th>
                <th>Gilt ab</th>
                <th>Lage</th>
                <th>Bestellungen</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{KIND_LABEL[v.kind]}</td>
                  <td>
                    <a href={`/admin/einstellungen/rechtstext?id=${v.id}`}>{v.version}</a>
                  </td>
                  <td>{dateTime.format(v.validFrom)}</td>
                  <td>
                    <span className={v.state === "gilt" ? "badge badge-ok" : "badge"}>{STATE_LABEL[v.state]}</span>
                  </td>
                  <td>{v.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {edit && (
          <details>
            <summary>Neue Fassung einspielen</summary>
            <ActionForm action={addLegalVersionAction} submit="Neue Fassung speichern" confirm="Neue Fassung speichern? Sie lässt sich danach nicht mehr ändern.">
              <label>
                Text
                <select name="kind" required>
                  {LEGAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bezeichnung der Fassung
                <input name="version" required placeholder="z. B. 2026-12-01 oder 3.2" />
              </label>
              <label>
                Gilt ab
                <input name="valid_from" type="date" min={today} defaultValue={today} required />
              </label>
              <label>
                Wortlaut
                <textarea name="content" rows={16} required />
              </label>
            </ActionForm>
          </details>
        )}
      </section>
    </>
  );
}
