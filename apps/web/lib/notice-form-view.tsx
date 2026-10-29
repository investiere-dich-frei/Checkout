"use client";

import { useActionState, useState } from "react";
import { submitCancellation, submitWithdrawal, type NoticeState } from "./notice-action";

const EMPTY: NoticeState = { errors: {}, message: null, values: {}, confirmation: null };

function Field(props: { name: string; label: string; type?: string; autoComplete?: string; state: NoticeState; hint?: string }) {
  const error = props.state.errors[props.name];
  return (
    <div className="full">
      <label htmlFor={props.name}>{props.label}</label>
      {props.hint && <p className="note" id={`${props.name}-hint`}>{props.hint}</p>}
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        defaultValue={props.state.values[props.name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={[props.hint ? `${props.name}-hint` : "", error ? `${props.name}-error` : ""].join(" ").trim() || undefined}
      />
      {error && (
        <p className="error" id={`${props.name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Confirmation(props: { confirmation: NonNullable<NoticeState["confirmation"]> }) {
  return (
    <section className="card" aria-live="polite">
      <h1>{props.confirmation.subject}</h1>
      <p>Die Bestätigung schicken wir dir auch per E-Mail. Du kannst diese Seite zusätzlich speichern oder drucken.</p>
      <pre className="confirmation">{props.confirmation.body}</pre>
      <button className="order" type="button" onClick={() => window.print()}>
        Bestätigung drucken oder als PDF speichern
      </button>
    </section>
  );
}

export function NoticeForm(props: { kind: "kuendigung" | "widerruf"; today: string }) {
  const [state, action, pending] = useActionState(props.kind === "kuendigung" ? submitCancellation : submitWithdrawal, EMPTY);
  const [type, setType] = useState("ordentlich");
  const [end, setEnd] = useState("naechstmoeglich");
  if (state.confirmation) return <Confirmation confirmation={state.confirmation} />;

  const kuendigung = props.kind === "kuendigung";
  return (
    <form action={action} className="card" noValidate>
      <h1>{kuendigung ? "Verträge hier kündigen" : "Vertrag widerrufen"}</h1>
      <p>
        {kuendigung
          ? "Hier kündigst du einen Vertrag mit uns, zum Beispiel ein Abo oder einen Ratenvertrag. Du bekommst sofort eine Eingangsbestätigung."
          : "Hier widerrufst du einen Vertrag mit uns. Du bekommst sofort eine Eingangsbestätigung."}
      </p>
      {state.message && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}

      {kuendigung && (
        <fieldset>
          <legend>Art der Kündigung</legend>
          {/* React setzt das Formular nach dem Absenden zurück; die Auswahl kommt deshalb aus dem Zustand. */}
          <input type="hidden" name="cancellation_type" value={type} />
          <div className="radio-row">
            <label>
              <input type="radio" name="cancellation_type_choice" value="ordentlich" checked={type === "ordentlich"} onChange={() => setType("ordentlich")} />
              Ordentliche Kündigung
            </label>
            <label>
              <input
                type="radio"
                name="cancellation_type_choice"
                value="ausserordentlich"
                checked={type === "ausserordentlich"}
                onChange={() => setType("ausserordentlich")}
              />
              Außerordentliche Kündigung
            </label>
          </div>
          {type === "ausserordentlich" && (
            <div className="grid" style={{ marginTop: 12 }}>
              <Field name="reason" label="Grund der Kündigung" state={state} />
            </div>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Deine Angaben</legend>
        <div className="grid">
          <Field name="full_name" label="Vor- und Nachname" autoComplete="name" state={state} />
          <Field name="email" label="E-Mail-Adresse für die Bestätigung" type="email" autoComplete="email" state={state} />
          <Field
            name="contract_reference"
            label="Welcher Vertrag?"
            hint="Bestellnummer, Rechnungsnummer oder Name des Produkts"
            state={state}
          />
        </div>
      </fieldset>

      {kuendigung && (
        <fieldset>
          <legend>Zu wann soll der Vertrag enden?</legend>
          <input type="hidden" name="end" value={end} />
          <div className="radio-row">
            <label>
              <input type="radio" name="end_choice" value="naechstmoeglich" checked={end === "naechstmoeglich"} onChange={() => setEnd("naechstmoeglich")} />
              Zum nächstmöglichen Zeitpunkt
            </label>
            <label>
              <input type="radio" name="end_choice" value="datum" checked={end === "datum"} onChange={() => setEnd("datum")} />
              Zu einem bestimmten Datum
            </label>
          </div>
          {end === "datum" && (
            <div className="grid" style={{ marginTop: 12 }}>
              <div className="full">
                <label htmlFor="end_date">Datum</label>
                <input id="end_date" name="end_date" type="date" min={props.today} defaultValue={state.values.end_date ?? ""} />
                {state.errors.end_date && <p className="error">{state.errors.end_date}</p>}
              </div>
            </div>
          )}
        </fieldset>
      )}

      <fieldset>
        <div className="grid">
          <div className="full">
            <label htmlFor="message">Nachricht an uns (freiwillig)</label>
            <textarea id="message" name="message" rows={3} defaultValue={state.values.message ?? ""} />
          </div>
        </div>
      </fieldset>

      <button className="order" type="submit" disabled={pending}>
        {pending ? "Wird gesendet …" : kuendigung ? "Jetzt kündigen" : "Widerruf bestätigen"}
      </button>
    </form>
  );
}
