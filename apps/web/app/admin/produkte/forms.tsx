"use client";

import { useActionState, useState, type ReactNode } from "react";
import { slugFromName } from "../../../lib/slug";
import type { FormState } from "./actions";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** Formular mit Rückmeldung unter dem Knopf; optional mit Sicherheitsabfrage. */
export function ActionForm(props: { action: Action; submit: string; confirm?: string; className?: string; children?: ReactNode }) {
  const [state, action, pending] = useActionState(props.action, { message: null });
  return (
    <form
      action={action}
      className={props.className ?? "product-form"}
      onSubmit={(e) => {
        if (props.confirm && !window.confirm(props.confirm)) e.preventDefault();
      }}
    >
      {props.children}
      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Speichert …" : props.submit}
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

export interface ProductValues {
  name: string;
  slug: string;
  internalLabel: string;
  taxCategory: string;
  immediateAccess: boolean;
}

/** Felder eines Produkts. Bei neuen Produkten wird die Adresse aus dem Namen vorgeschlagen. */
export function ProductFields(props: { values: ProductValues; isNew: boolean; companies?: { id: string; name: string }[] }) {
  const [name, setName] = useState(props.values.name);
  const [slug, setSlug] = useState(props.values.slug);
  const [slugTouched, setSlugTouched] = useState(!props.isNew);
  return (
    <>
      {props.companies && props.companies.length > 1 && (
        <div className="field">
          <label htmlFor="company_id">Verkaufende Gesellschaft</label>
          <select id="company_id" name="company_id" required defaultValue="">
            <option value="" disabled>
              Bitte wählen
            </option>
            {props.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="name">Produktname (steht auf Kaufseite und Rechnung)</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugFromName(e.target.value));
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="slug">Adresse im Kauflink (Slug)</label>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
        />
        <p className="note">
          Kauflink: /kaufen/<strong>{slug || "…"}</strong>/… · Nur Kleinbuchstaben, Ziffern und Bindestriche.
          {!props.isNew && " Achtung: Wer die Adresse ändert, macht bereits verschickte Kauflinks ungültig."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="internal_label">Interne Notiz (optional, nur in der Verwaltung sichtbar)</label>
        <input id="internal_label" name="internal_label" type="text" defaultValue={props.values.internalLabel} />
      </div>
      <fieldset className="field">
        <legend>Umsatzsteuer</legend>
        <div className="radio-row">
          <label>
            <input type="radio" name="tax_category" value="standard" required defaultChecked={props.values.taxCategory === "standard"} />
            Mit Umsatzsteuer (19 % in Deutschland, Satz des Landes in EU/Schweiz)
          </label>
          <label>
            <input type="radio" name="tax_category" value="steuerfrei_4_21" defaultChecked={props.values.taxCategory === "steuerfrei_4_21"} />
            Steuerfrei nach § 4 Nr. 21 UStG (gilt für Käufer in Deutschland)
          </label>
        </div>
      </fieldset>
      <div className="field check">
        <input id="immediate_access" name="immediate_access" type="checkbox" defaultChecked={props.values.immediateAccess} />
        <label htmlFor="immediate_access">
          Sofortzugang am Kauftag, ohne Sofortstart-Häkchen im Checkout (wie bei Masterclass Essential)
        </label>
      </div>
    </>
  );
}

export interface OptionValues {
  label: string;
  kind: string;
  amountBasis: string;
  amount: string;
  recurringAmount: string;
  recurringCount: string;
  intervalMonths: string;
  trialDays: string;
}

/** Felder einer Preisoption; zeigt nur, was zur gewählten Zahlart gehört. */
export function PriceOptionFields(props: { values: OptionValues }) {
  const [kind, setKind] = useState(props.values.kind || "einmal");
  const once = kind === "einmal";
  return (
    <>
      <div className="field">
        <label htmlFor="label">Bezeichnung (steht auf Kaufseite und Rechnung)</label>
        <input id="label" name="label" type="text" required maxLength={200} defaultValue={props.values.label} placeholder="z. B. Einmalzahlung, 6 Monatsraten" />
      </div>
      <div className="field">
        <label htmlFor="kind">Zahlart</label>
        <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="einmal">Einmalzahlung</option>
          <option value="raten">Raten (alle Zahlungen gleich hoch)</option>
          <option value="anzahlung">Anzahlung, danach Raten</option>
          <option value="abo">Abo (läuft bis zur Kündigung)</option>
        </select>
      </div>
      <fieldset className="field">
        <legend>Preise sind</legend>
        <div className="radio-row">
          <label>
            <input type="radio" name="amount_basis" value="brutto" required defaultChecked={props.values.amountBasis === "brutto"} />
            brutto: Steuer ist im Preis enthalten (Kunde zahlt genau diesen Betrag)
          </label>
          <label>
            <input type="radio" name="amount_basis" value="netto" defaultChecked={props.values.amountBasis === "netto"} />
            netto: Steuer kommt dazu (wie bisher in Thrivecart)
          </label>
        </div>
      </fieldset>
      <div className="field-row">
        <div className="field">
          <label htmlFor="amount">{once ? "Preis in €" : kind === "anzahlung" ? "Anzahlung in €" : "Erste Zahlung in €"}</label>
          <input id="amount" name="amount" type="text" inputMode="decimal" required={once || kind === "anzahlung"} defaultValue={props.values.amount} placeholder="z. B. 1.497" />
          {(kind === "raten" || kind === "abo") && <p className="note">0, wenn die erste Zahlung erst nach der Probezeit fällig ist.</p>}
        </div>
        {!once && (
          <>
            <div className="field">
              <label htmlFor="recurring_amount">{kind === "abo" ? "Betrag je Abrechnung in €" : "Betrag je Folgezahlung in €"}</label>
              <input id="recurring_amount" name="recurring_amount" type="text" inputMode="decimal" required defaultValue={props.values.recurringAmount} />
            </div>
            {kind !== "abo" && (
              <div className="field">
                <label htmlFor="recurring_count">Anzahl Folgezahlungen (ohne die erste)</label>
                <input id="recurring_count" name="recurring_count" type="text" inputMode="numeric" required defaultValue={props.values.recurringCount} />
              </div>
            )}
            <div className="field">
              <label htmlFor="interval_months">Abstand in Monaten</label>
              <input id="interval_months" name="interval_months" type="text" inputMode="numeric" required defaultValue={props.values.intervalMonths || "1"} />
            </div>
            <div className="field">
              <label htmlFor="trial_days">Probezeit in Tagen (optional)</label>
              <input id="trial_days" name="trial_days" type="text" inputMode="numeric" defaultValue={props.values.trialDays} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
