"use client";

import { CREDIT_AGREEMENT_TEXT, VALUE_COMPENSATION_TEXT } from "@idf/db/credit-texts";
import { useActionState } from "react";
import { submitCreditOrder, type CreditOrderState } from "./actions";

/** Zustimmungen zum Ratenvertrag. Kein Kästchen ist vorangekreuzt (§ 492 Abs. 1a BGB n. F.). */
export function CreditOrderForm(props: { checkId: string; informationSha: string; withdrawalText: string; dueNow: string }) {
  const [state, action, pending] = useActionState<CreditOrderState, FormData>(submitCreditOrder, { message: null, errors: {} });
  return (
    <form action={action} noValidate>
      <input type="hidden" name="check_id" value={props.checkId} />
      <input type="hidden" name="info_sha" value={props.informationSha} />
      <section className="card" aria-labelledby="vertrag">
        <h2 id="vertrag">Ratenvertrag abschließen</h2>
        <label className="check">
          <input type="checkbox" name="terms" aria-describedby={state.errors.terms ? "terms-error" : undefined} />
          <span>
            Ich akzeptiere die <a href="https://www.investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen" target="_blank" rel="noreferrer">AGB</a> und habe die{" "}
            <a href="https://www.investieredichfrei.de/rechtliches/datenschutzerklaerung" target="_blank" rel="noreferrer">Datenschutzhinweise</a> gelesen.
          </span>
        </label>
        {state.errors.terms && <p className="error" id="terms-error">{state.errors.terms}</p>}
        <label className="check">
          <input type="checkbox" name="credit_agreement" aria-describedby={state.errors.credit_agreement ? "agreement-error" : undefined} />
          <span>{CREDIT_AGREEMENT_TEXT}</span>
        </label>
        {state.errors.credit_agreement && <p className="error" id="agreement-error">{state.errors.credit_agreement}</p>}
        <label className="check">
          <input type="checkbox" name="value_compensation" aria-describedby="vc-note" />
          <span>{VALUE_COMPENSATION_TEXT} (freiwillig)</span>
        </label>
        <p className="note" id="vc-note">
          Ohne Häkchen kannst du trotzdem kaufen. Deinen Zugang bekommst du dann am Tag nach Ablauf der 14-tägigen Widerrufsfrist.
        </p>
        <details>
          <summary>Widerrufsinformation lesen</summary>
          <p style={{ whiteSpace: "pre-line" }}>{props.withdrawalText}</p>
        </details>
      </section>
      {state.message && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      <p className="total" aria-live="polite">
        Jetzt zu zahlen: {props.dueNow}
      </p>
      <button type="submit" className="order" disabled={pending}>
        {pending ? "Bestellung wird gesendet …" : "Zahlungspflichtig bestellen"}
      </button>
    </form>
  );
}
