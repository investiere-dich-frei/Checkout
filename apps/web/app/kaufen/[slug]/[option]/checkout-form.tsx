"use client";

import type { AmountBasis, PricePlan } from "@idf/core/pricing";
import type { TaxCategory } from "@idf/core/tax";
import { EMPLOYMENTS } from "@idf/core/credit";
import { CREDIT_WARNING } from "@idf/db/credit-texts";
import { SOFORTSTART_TEXT } from "@idf/db/legal";
import { useActionState, useEffect, useState, useTransition } from "react";
import { COUNTRIES } from "../../../../lib/countries";
import { formatCents, formatDay, formatRate } from "../../../../lib/format";
import { solveInBrowser } from "../../../../lib/pow-client";
import { previewPrice } from "../../../../lib/price-preview";
import { checkCouponAction, submitOrder, type CheckoutState, type CouponPreview } from "./actions";

interface OfferProps {
  priceOptionId: string;
  currency: string;
  amountBasis: AmountBasis;
  taxCategory: TaxCategory;
  chVatRateBp: number | null;
  immediateAccess: boolean;
  plan: PricePlan;
}

const INTERVAL: Record<number, string> = { 1: "monatlich", 3: "vierteljährlich", 6: "halbjährlich", 12: "jährlich" };

function Field(props: { name: string; label: string; type?: string; autoComplete?: string; state: CheckoutState; full?: boolean }) {
  const error = props.state.errors[props.name];
  return (
    <div className={props.full ? "full float" : "float"}>
      {/* Beschriftung steht im Feld und rutscht beim Tippen nach oben (wie bei Thrivecart). */}
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        placeholder=" "
        autoComplete={props.autoComplete}
        defaultValue={props.state.values[props.name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${props.name}-error` : undefined}
      />
      <label htmlFor={props.name}>{props.label}</label>
      {error && (
        <p className="error" id={`${props.name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Fragebogen zur Bonität (nur Ratenkauf mit Kredit, nur Privatkundinnen). Namen wie in @idf/db/credit parseCreditAnswers. */
function CreditQuestions(props: { state: CheckoutState }) {
  const e = props.state.errors;
  const v = props.state.values;
  const err = (k: string) => (e[k] ? <p className="error" id={`${k}-error`}>{e[k]}</p> : null);
  const money = (name: string, label: string, hint: string, errKey: string) => (
    <div className="full float">
      <input id={name} name={name} inputMode="decimal" placeholder=" " defaultValue={v[name] ?? ""} aria-invalid={e[errKey] ? true : undefined} aria-describedby={`${name}-hint`} />
      <label htmlFor={name}>{label}</label>
      <p className="note" id={`${name}-hint`}>{hint}</p>
      {err(errKey)}
    </div>
  );
  return (
    <section className="card" aria-labelledby="raten-fragen">
      <h2 id="raten-fragen">Kurz zu deiner Ratenzahlung</h2>
      <p className="note">
        Bevor wir dir eine Ratenzahlung anbieten, müssen wir gesetzlich prüfen, ob die Raten zu deinen Finanzen passen (§ 505a BGB). Dafür brauchen wir ein paar
        Angaben. Wir nutzen sie nur für diese Prüfung, fragen keine Auskunftei und keine sozialen Netzwerke ab.
      </p>
      <div className="grid" key={JSON.stringify(v)}>
        <div className="full float float-select">
          <select id="credit_employment" name="credit_employment" defaultValue={v.credit_employment ?? ""} aria-invalid={e.employment ? true : undefined}>
            <option value="" disabled>
              Bitte wählen
            </option>
            {Object.entries(EMPLOYMENTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="credit_employment">Ich bin …</label>
          {err("employment")}
        </div>
        {money("credit_income", "Monatliches Netto-Einkommen in €", "Alles, was dir im Monat zur Verfügung steht (Gehalt, Rente, Unterhalt …).", "netIncomeCents")}
        {money("credit_housing", "Monatliche Wohnkosten in €", "Miete mit Nebenkosten oder Kreditrate fürs Zuhause.", "housingCents")}
        {money("credit_other", "Andere Raten pro Monat in €", "Kredite, Leasing, „Später bezahlen“ (Klarna, PayPal …). 0, wenn keine.", "otherCreditsCents")}
        <div className="full float">
          <input id="credit_dependents" name="credit_dependents" inputMode="numeric" placeholder=" " defaultValue={v.credit_dependents ?? "0"} aria-invalid={e.dependents ? true : undefined} />
          <label htmlFor="credit_dependents">Personen, die du finanziell mitversorgst</label>
          <p className="note">Zum Beispiel Kinder. 0, wenn niemand.</p>
          {err("dependents")}
        </div>
        <fieldset className="full">
          <legend>Gibt es bei dir gerade ein Mahnverfahren, eine Pfändung oder eine Insolvenz?</legend>
          <div className="radio-row">
            <label>
              <input type="radio" name="credit_problems" value="nein" defaultChecked={v.credit_problems === "nein"} /> Nein
            </label>
            <label>
              <input type="radio" name="credit_problems" value="ja" defaultChecked={v.credit_problems === "ja"} /> Ja
            </label>
          </div>
          {err("paymentProblems")}
        </fieldset>
      </div>
      <label className="check">
        <input type="checkbox" name="credit_adult" />
        <span>Ich bin mindestens 18 Jahre alt.</span>
      </label>
      {err("adult")}
      <label className="check">
        <input type="checkbox" name="credit_confirm" />
        <span>Meine Angaben sind vollständig und richtig.</span>
      </label>
      {err("confirmed")}
      <p className="note">
        Die Auswertung läuft automatisch. Du kannst jederzeit verlangen, dass ein Mensch aus unserem Team die Entscheidung prüft und dir erklärt.
      </p>
    </section>
  );
}

export function CheckoutForm(props: {
  slug: string;
  offer: OfferProps;
  sellerCode: string | null;
  purchaseDay: string;
  withdrawalText: string;
  /** Gutschein aus dem Link (?gutschein=CODE), schon geprüft. */
  initialCoupon?: CouponPreview | null;
  /** Ratenkauf mit Kredit: null, wenn kein Kredit. enabled = false, solange der Ratenkauf ausgeschaltet ist. */
  credit?: { enabled: boolean; monthlyRateCents: number } | null;
  /** Rechenaufgabe gegen automatisierte Bestellungen (lib/pow.ts). */
  challenge: string;
  powBits: number;
}) {
  const { offer } = props;
  const [state, action, pending] = useActionState<CheckoutState, FormData>(submitOrder, {
    errors: {},
    message: null,
    values: {},
    challenge: props.challenge,
  });
  // Die Aufgabe wird im Hintergrund gelöst, während die Kundin das Formular ausfüllt.
  const [solved, setSolved] = useState<{ challenge: string; nonce: string } | null>(null);
  const [powFailed, setPowFailed] = useState(false);
  useEffect(() => {
    const signal = { cancelled: false };
    setSolved(null);
    solveInBrowser(state.challenge, props.powBits, signal).then((nonce) => {
      if (signal.cancelled) return;
      if (nonce === null) setPowFailed(true);
      else setSolved({ challenge: state.challenge, nonce });
    });
    return () => {
      signal.cancelled = true;
    };
  }, [state.challenge, props.powBits]);
  const ready = solved?.challenge === state.challenge;
  const [country, setCountry] = useState("DE");
  const [kind, setKind] = useState<"privat" | "unternehmen">("privat");
  const [coupon, setCoupon] = useState<CouponPreview | null>(props.initialCoupon?.ok ? props.initialCoupon : null);
  const [couponInput, setCouponInput] = useState(props.initialCoupon?.ok ? props.initialCoupon.code : "");
  const [couponMessage, setCouponMessage] = useState<string | null>(props.initialCoupon && !props.initialCoupon.ok ? props.initialCoupon.message : null);
  const [checking, startCheck] = useTransition();
  const applied = coupon?.ok ? coupon : null;
  const couponError = couponMessage ?? state.errors.coupon ?? null;

  const applyCoupon = () =>
    startCheck(async () => {
      const r = await checkCouponAction(couponInput, offer.priceOptionId);
      if (r.ok) {
        setCoupon(r);
        setCouponMessage(null);
      } else {
        setCoupon(null);
        setCouponMessage(r.message);
      }
    });

  const p = previewPrice({
    plan: offer.plan,
    amountBasis: offer.amountBasis,
    taxCategory: offer.taxCategory,
    chVatRateBp: offer.chVatRateBp,
    country,
    isBusiness: kind === "unternehmen",
    purchaseDay: props.purchaseDay,
    discount: applied?.discount ?? null,
  });
  const money = (c: number) => formatCents(c, offer.currency);
  const interval = offer.plan.intervalMonths ? INTERVAL[offer.plan.intervalMonths] ?? `alle ${offer.plan.intervalMonths} Monate` : "";
  const later = p.schedule.filter((s) => s.dueDate !== props.purchaseDay);
  // Kreditrecht gilt nur für Verbraucher; Unternehmen bestellen wie bisher.
  const creditFlow = !!props.credit && kind === "privat";
  const creditBlocked = creditFlow && !props.credit!.enabled;

  return (
    <form action={action} noValidate>
      <input type="hidden" name="price_option_id" value={offer.priceOptionId} />
      <input type="hidden" name="slug" value={props.slug} />
      {props.sellerCode && <input type="hidden" name="seller" value={props.sellerCode} />}
      <input type="hidden" name="coupon" value={applied?.code ?? ""} />
      <input type="hidden" name="pow_challenge" value={state.challenge} />
      <input type="hidden" name="pow_nonce" value={solved && ready ? solved.nonce : ""} />

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
          <div className="full float float-select">
            <select id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country">
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <label htmlFor="country">Land</label>
          </div>
          {kind === "unternehmen" && <Field name="vat_id" label="USt-IdNr. (optional)" state={state} full />}
        </div>
      </section>

      <section className="card" aria-labelledby="preis">
        <h2 id="preis">Deine Bestellung</h2>
        <div className="coupon-box">
          {applied ? (
            <p className="coupon-applied" role="status">
              Gutschein <strong>{applied.code}</strong> eingelöst: {applied.text}.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setCoupon(null);
                  setCouponInput("");
                }}
              >
                Entfernen
              </button>
            </p>
          ) : (
            <details open={!!couponError || !!couponInput}>
              <summary>Gutscheincode einlösen</summary>
              <div className="coupon-row">
                <input
                  id="coupon_input"
                  aria-label="Gutscheincode"
                  type="text"
                  autoComplete="off"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCoupon();
                    }
                  }}
                  aria-invalid={couponError ? true : undefined}
                  aria-describedby={couponError ? "coupon-error" : undefined}
                />
                <button type="button" onClick={applyCoupon} disabled={checking || !couponInput.trim()}>
                  {checking ? "Prüfe …" : "Einlösen"}
                </button>
              </div>
              {couponError && (
                <p className="error" id="coupon-error">
                  {couponError}
                </p>
              )}
            </details>
          )}
        </div>
        <table className="summary-table">
          <tbody>
            {applied && p.savingsCents > 0 && (
              <tr className="coupon-line">
                <td>
                  Gutschein {applied.code}
                  {offer.plan.kind === "abo" && p.recurringSavingsCents > 0 && ` (auch − ${money(p.recurringSavingsCents)} bei jeder Folgezahlung)`}
                </td>
                <td>− {money(p.savingsCents)}</td>
              </tr>
            )}
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
        {props.credit && (
          <p className="note">
            <strong>{CREDIT_WARNING}</strong> Bei uns kostet die Ratenzahlung nichts extra: 0,00 % Zinsen, der Gesamtpreis ist derselbe wie bei Einmalzahlung.
          </p>
        )}
      </section>

      {creditFlow && !creditBlocked && <CreditQuestions state={state} />}
      {props.credit && kind === "unternehmen" && (
        <section className="card" aria-labelledby="gewerblich">
          <h2 id="gewerblich">Kauf als Unternehmen</h2>
          <label className="check">
            <input type="checkbox" name="business_purpose" />
            <span>Ich kaufe für meine gewerbliche oder selbständige berufliche Tätigkeit, nicht als Privatperson.</span>
          </label>
          <p className="note">Nötig für Ratenzahlung als Unternehmen, wenn wir keine gültige USt-IdNr. prüfen konnten.</p>
        </section>
      )}
      {creditBlocked && (
        <p className="error" role="alert">
          Ratenzahlung können wir gerade nicht anbieten. Bitte wähle die Einmalzahlung oder frag uns nach einem kürzeren Zahlplan.
        </p>
      )}

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
        {creditFlow ? (
          <p className="note">
            Im nächsten Schritt bekommst du die Informationen zu deiner Ratenzahlung und schließt den Ratenvertrag ab. Dort entscheidest du auch über den sofortigen
            Start.
          </p>
        ) : offer.immediateAccess ? (
          <p className="note">Deinen Zugang bekommst du sofort nach dem Kauf.</p>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" name="waiver" aria-describedby="waiver-note" />
              <span>{SOFORTSTART_TEXT} (freiwillig)</span>
            </label>
            <p className="note" id="waiver-note">
              Ohne Häkchen kannst du trotzdem kaufen. Deinen Zugang bekommst du dann am Tag nach Ablauf der 14-tägigen Widerrufsfrist.
            </p>
          </>
        )}
        {!creditFlow && (
          <details>
            <summary>Widerrufsbelehrung lesen</summary>
            <p style={{ whiteSpace: "pre-line" }}>{props.withdrawalText}</p>
          </details>
        )}
      </section>

      {state.message && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      {!creditFlow && (
        <p className="total" aria-live="polite">
          Jetzt zu zahlen: {money(p.dueNowCents)}
        </p>
      )}
      {powFailed && (
        <p className="error" role="alert">
          Dein Browser kann die Sicherheitsprüfung nicht ausführen. Bitte nutze einen aktuellen Browser oder schreib uns an service@investieredichfrei.de.
        </p>
      )}
      <button type="submit" className="order" disabled={pending || !ready || creditBlocked}>
        {pending
          ? creditFlow
            ? "Angaben werden geprüft …"
            : "Bestellung wird gesendet …"
          : !ready
            ? "Einen Moment, Sicherheitsprüfung …"
            : creditFlow
              ? "Weiter: Angaben prüfen"
              : "Zahlungspflichtig bestellen"}
      </button>
    </form>
  );
}
