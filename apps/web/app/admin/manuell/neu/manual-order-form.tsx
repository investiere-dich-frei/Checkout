"use client";

import { MANUAL_MODEL_LABEL, manualPlan, ManualPlanError, type ManualPaymentModel } from "@idf/core/manual-plan";
import { useActionState, useMemo, useState } from "react";
import { COUNTRIES } from "../../../../lib/countries";
import { formatCents, formatDay } from "../../../../lib/format";
import { createManualOrderAction } from "../actions";

export interface FormProduct {
  id: string;
  name: string;
  active: boolean;
  steuerfrei: boolean;
  prices: string | null;
}

/** Euro-Eingabe für die Vorschau; verbindlich prüft der Server. */
function cents(raw: string): number | null {
  const s = raw.replace(/€|\s/g, "");
  if (!s) return null;
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s) ?? /^(\d+)\.(\d{1,2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]!.replace(/\./g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function ManualOrderForm(props: {
  products: FormProduct[];
  sellers: { id: string; display_name: string }[] | null;
  canBook: boolean;
  today: string;
  ownUserId: string;
}) {
  const [state, action, pending] = useActionState(createManualOrderAction, { message: null });
  // Nach einem Fehler setzt React das Formular zurück; die Eingaben kommen aus der Antwort zurück.
  const v = (k: string) => state.values?.[k] ?? "";
  const [kind, setKind] = useState<"privat" | "unternehmen">("privat");
  const [model, setModel] = useState<ManualPaymentModel>("einmal");
  const [productId, setProductId] = useState("");
  const [total, setTotal] = useState("");
  const [first, setFirst] = useState("");
  const [count, setCount] = useState("");
  const [next, setNext] = useState("");
  const [term, setTerm] = useState("14");
  const [paid, setPaid] = useState(false);
  const product = props.products.find((p) => p.id === productId);

  const preview = useMemo(() => {
    const t = cents(total);
    if (t === null) return null;
    try {
      return {
        ok: true as const,
        rows: manualPlan({
          model,
          totalCents: t,
          firstCents: cents(first),
          installmentCount: count ? Number(count) : null,
          nextDueDate: next || null,
          issueDay: props.today,
          paymentTermDays: Number(term || "0"),
        }),
      };
    } catch (err) {
      if (err instanceof ManualPlanError) return { ok: false as const, message: err.message };
      return null;
    }
  }, [model, total, first, count, next, term, props.today]);

  return (
    <form action={action} className="product-form">
      <fieldset className="field">
        <legend>Produkt</legend>
        <select name="product_id" required value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="" disabled>
            Bitte wählen
          </option>
          {props.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.active ? "" : " (nicht im Shop)"}
            </option>
          ))}
        </select>
        {product && (
          <p className="note">
            {product.steuerfrei ? "Steuerfrei nach § 4 Nr. 21 UStG (Käufer in Deutschland)." : "Mit Umsatzsteuer; der Satz richtet sich nach dem Land."}
            {product.prices && <> Preise im Shop: {product.prices}</>}
          </p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Kundin</legend>
        <div className="radio-row" style={{ flexDirection: "row", gap: 20 }}>
          <label>
            <input type="radio" name="kind" value="privat" checked={kind === "privat"} onChange={() => setKind("privat")} /> Privat
          </label>
          <label>
            <input type="radio" name="kind" value="unternehmen" checked={kind === "unternehmen"} onChange={() => setKind("unternehmen")} /> Unternehmen
          </label>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="first_name">Vorname</label>
            <input type="text" id="first_name" name="first_name" defaultValue={v("first_name")} required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="last_name">Nachname</label>
            <input type="text" id="last_name" name="last_name" defaultValue={v("last_name")} required autoComplete="off" />
          </div>
        </div>
        {kind === "unternehmen" && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="company_name">Firma</label>
              <input type="text" id="company_name" name="company_name" defaultValue={v("company_name")} required />
            </div>
            <div className="field">
              <label htmlFor="vat_id">USt-IdNr. (optional, nur EU-Ausland)</label>
              <input type="text" id="vat_id" name="vat_id" defaultValue={v("vat_id")} />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">E-Mail (bekommt die Rechnung)</label>
          <input id="email" name="email" defaultValue={v("email")} type="email" required autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="street">Straße und Hausnummer</label>
          <input type="text" id="street" name="street" defaultValue={v("street")} required />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="postal_code">PLZ</label>
            <input type="text" id="postal_code" name="postal_code" defaultValue={v("postal_code")} required />
          </div>
          <div className="field">
            <label htmlFor="city">Ort</label>
            <input type="text" id="city" name="city" defaultValue={v("city")} required />
          </div>
          <div className="field">
            <label htmlFor="country">Land</label>
            <select id="country" name="country" defaultValue={v("country") || "DE"} required>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Betrag und Zahlung</legend>
        <div className="field-row">
          <div className="field">
            <label htmlFor="total">Gesamtbetrag brutto (was die Kundin zahlt)</label>
            <input type="text" id="total" name="total" inputMode="decimal" required placeholder="z. B. 2.997,00" value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="payment_term_days">Zahlungsziel erste Zahlung (Tage)</label>
            <input type="text" id="payment_term_days" name="payment_term_days" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
        <div className="radio-row">
          {(Object.keys(MANUAL_MODEL_LABEL) as ManualPaymentModel[]).map((m) => (
            <label key={m}>
              <input type="radio" name="payment_model" value={m} checked={model === m} onChange={() => setModel(m)} /> {MANUAL_MODEL_LABEL[m]}
            </label>
          ))}
        </div>
        {model !== "einmal" && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="first">{model === "raten" ? "Rate 1 (brutto)" : "Anzahlung (brutto)"}</label>
              <input type="text" id="first" name="first" inputMode="decimal" required value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            {(model === "raten" || model === "anzahlung_raten") && (
              <div className="field">
                <label htmlFor="installment_count">{model === "raten" ? "Anzahl Raten insgesamt" : "Anzahl Raten nach der Anzahlung"}</label>
                <input type="text" id="installment_count" name="installment_count" inputMode="numeric" required value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="next_due_date">{model === "anzahlung_rest" ? "Restzahlung fällig am" : "Nächste Rate fällig am (danach monatlich)"}</label>
              <input id="next_due_date" name="next_due_date" type="date" min={props.today} required value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
          </div>
        )}
        {preview && !preview.ok && <p className="status-error">{preview.message}</p>}
        {preview?.ok && (
          <table className="admin-table" aria-label="Zahlungsplan">
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.seq}>
                  <td>{r.label}</td>
                  <td>{r.seq === 1 ? `bis ${formatDay(r.dueDate)}` : formatDay(r.dueDate)}</td>
                  <td>{formatCents(r.grossCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      {props.sellers && (
        <div className="field">
          <label htmlFor="seller_user_id">Vertriebsperson (Verkäufernachweis)</label>
          <select id="seller_user_id" name="seller_user_id" defaultValue={state.values ? v("seller_user_id") : props.ownUserId}>
            <option value="">ohne Vertrieb</option>
            {props.sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {props.canBook && (
        <fieldset className="field">
          <div className="check">
            <input id="already_paid" name="already_paid" type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            <label htmlFor="already_paid">Die erste Zahlung ist schon auf dem Konto eingegangen</label>
          </div>
          {paid && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="paid_on">Eingang am</label>
                <input id="paid_on" name="paid_on" type="date" max={props.today} required defaultValue={v("paid_on")} />
              </div>
              <div className="field">
                <label htmlFor="paid_reference">Referenz (optional, z. B. Buchungstext)</label>
                <input type="text" id="paid_reference" name="paid_reference" defaultValue={v("paid_reference")} />
              </div>
            </div>
          )}
        </fieldset>
      )}

      <div className="field check">
        <input id="send_mail" name="send_mail" type="checkbox" defaultChecked />
        <label htmlFor="send_mail">Rechnung mit Widerrufsbelehrung und AGB sofort per E-Mail an die Kundin schicken (von buchhaltung@)</label>
      </div>
      <div className="field">
        <label htmlFor="internal_note">Interne Notiz (optional, nur in der Verwaltung)</label>
        <input type="text" id="internal_note" name="internal_note" defaultValue={v("internal_note")} />
      </div>

      <div className="form-actions">
        <button
          type="submit"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm("Rechnung jetzt verbindlich ausstellen? Die Rechnungsnummer wird vergeben und lässt sich nur noch stornieren.")) e.preventDefault();
          }}
        >
          {pending ? "Stellt aus …" : "Rechnung ausstellen"}
        </button>
        {state.message && (
          <p role="status" className={state.ok ? "status-ok" : "status-error"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
