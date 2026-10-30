"use client";

import type { AmountBasis, PricePlan } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
import { SOFORTSTART_TEXT } from "@idf/db/legal";
import { useActionState, useState } from "react";
import { COUNTRIES } from "../../../../lib/countries";
import { formatCents, formatDay, formatRate } from "../../../../lib/format";
import { previewPrice } from "../../../../lib/price-preview";
import { submitOrder, type CheckoutState } from "./actions";

interface OfferProps {
  priceOptionId: string;
  currency: string;
  amountBasis: AmountBasis;
  taxCategory: TaxCategory;
  chVatRateBp: number | null;
  plan: PricePlan;
}

const INTERVAL: Record<number, string> = { 1: "monatlich", 3: "vierteljährlich", 6: "halbjährlich", 12: "jährlich" };

function Field(props: { name: string; label: string; type?: string; autoComplete?: string; state: CheckoutState; full?: boolean }) {
  const error = props.state.errors[props.name];
  return (
    <div className={props.full ? "full" : undefined}>
      <label htmlFor={props.name}>{props.label}</label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        defaultValue={props.state.values[props.name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${props.name}-error` : undefined}
      />
      {error && (
        <p className="error" id={`${props.name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckoutForm(props: {
  slug: string;
  offer: OfferProps;
  sellerCode: string | null;
  purchaseDay: string;
  withdrawalText: string;
}) {
  const { offer } = props;
  const [state, action, pending] = useActionState<CheckoutState, FormData>(submitOrder, { errors: {}, message: null, values: {} });
  const [country, setCountry] = useState("DE");
  const [kind, setKind] = useState<"privat" | "unternehmen">("privat");

  const p = previewPrice({
    plan: offer.plan,
    amountBasis: offer.amountBasis,
    taxCategory: offer.taxCategory,
    chVatRateBp: offer.chVatRateBp,
    country,
    isBusiness: kind === "unternehmen",
    purchaseDay: props.purchaseDay,
  });
  const money = (c: number) => formatCents(c, offer.currency);
  const interval = offer.plan.intervalMonths ? INTERVAL[offer.plan.intervalMonths] ?? `alle ${offer.plan.intervalMonths} Monate` : "";
  const later = p.schedule.filter((s) => s.dueDate !== props.purchaseDay);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="price_option_id" value={offer.priceOptionId} />
      {props.sellerCode && <input type="hidden" name="seller" value={props.sellerCode} />}

      <section className="card" aria-labelledby="kontakt">
        <h2 id="kontakt">Deine Angaben</h2>
        <fieldset>
          <legend>Ich kaufe als</legend>
          <div className="radio-row">
            <label>
              <input type="radio" name="kind" value="privat" checked={kind === "privat"} onChange={() => setKind("privat")} /> Privatperson
            </label>
            <label>
              <input type="radio" name="kind" value="unternehmen" checked={kind === "unternehmen"} onChange={() => setKind("unternehmen")} />{" "}
              Unternehmen
            </label>
          </div>
        </fieldset>
        <div className="grid" key={JSON.stringify(state.values)}>
          <Field name="first_name" label="Vorname" autoComplete="given-name" state={state} />
          <Field name="last_name" label="Nachname" autoComplete="family-name" state={state} />
          {kind === "unternehmen" && <Field name="company_name" label="Unternehmen" autoComplete="organization" state={state} full />}
          <Field name="email" label="E-Mail" type="email" autoComplete="email" state={state} full />
          <Field name="street" label="Straße und Hausnummer" autoComplete="street-address" state={state} full />
          <Field name="postal_code" label="PLZ" autoComplete="postal-code" state={state} />
          <Field name="city" label="Ort" autoComplete="address-level2" state={state} />
          <div className="full">
            <label htmlFor="country">Land</label>
            <select id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country">
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {kind === "unternehmen" && <Field name="vat_id" label="USt-IdNr. (optional)" state={state} full />}
        </div>
      </section>

      <section className="card" aria-labelledby="preis">
        <h2 id="preis">Deine Bestellung</h2>
        <table className="summary-table">
          <tbody>
            {later.length > 0 && (
              <tr>
                <td>Heute fällig</td>
                <td>{money(p.dueNowCents)}</td>
              </tr>
            )}
            {later.length > 0 && p.recurringCents !== null && (
              <tr>
                <td>
                  {offer.plan.recurringCount === null
                    ? `danach ${interval}, kündbar`
                    : `danach ${offer.plan.recurringCount} × ${interval}, erste Folgezahlung am ${formatDay(later[0]!.dueDate)}`}
                </td>
                <td>{money(p.recurringCents)}</td>
              </tr>
            )}
            <tr className="total">
              <td>{p.totalCents === null ? `Preis ${interval}` : "Gesamtpreis"}</td>
              <td>{money(p.totalCents ?? p.recurringCents ?? p.dueNowCents)}</td>
            </tr>
          </tbody>
        </table>
        <p className="note">
          {p.rateBp > 0 ? `inkl. ${formatRate(p.rateBp)} Umsatzsteuer` : p.note}
          {kind === "unternehmen" && country !== "DE" && " Reverse Charge wird nach Prüfung der USt-IdNr. auf der Rechnung berücksichtigt."}
        </p>
      </section>

      <section className="card" aria-labelledby="zustimmung">
        <h2 id="zustimmung">Zustimmung</h2>
        <label className="check">
          <input type="checkbox" name="terms" aria-describedby={state.errors.terms ? "terms-error" : undefined} />
          <span>
            Ich akzeptiere die <a href="https://www.investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen" target="_blank" rel="noreferrer">AGB</a> und habe die{" "}
            <a href="https://www.investieredichfrei.de/rechtliches/datenschutzerklaerung" target="_blank" rel="noreferrer">Datenschutzhinweise</a> gelesen.
          </span>
        </label>
        {state.errors.terms && <p className="error" id="terms-error">{state.errors.terms}</p>}
        <label className="check">
          <input type="checkbox" name="waiver" aria-describedby="waiver-note" />
          <span>{SOFORTSTART_TEXT} (freiwillig)</span>
        </label>
        <p className="note" id="waiver-note">
          Ohne Häkchen kannst du trotzdem kaufen. Deinen Zugang bekommst du dann am Tag nach Ablauf der 14-tägigen Widerrufsfrist.
        </p>
        <details>
          <summary>Widerrufsbelehrung lesen</summary>
          <p style={{ whiteSpace: "pre-line" }}>{props.withdrawalText}</p>
        </details>
      </section>

      {state.message && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      <p className="total" aria-live="polite">
        Jetzt zu zahlen: {money(p.dueNowCents)}
      </p>
      <button type="submit" className="order" disabled={pending}>
        {pending ? "Bestellung wird gesendet …" : "Zahlungspflichtig bestellen"}
      </button>
    </form>
  );
}
