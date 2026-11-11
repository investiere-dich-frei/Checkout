"use client";

import { useActionState, useState } from "react";
import { stornoOrderAction } from "../../actions";

const euro = (cents: number, currency: string) => new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);

export interface StornoInvoice {
  id: string;
  number: string;
  refundableCents: number;
}

/**
 * Storno einer Bestellung mit zwei klaren Wegen:
 * ohne Rückzahlung (nur beenden) und mit Rückzahlung (beenden und gewählte Rechnungen erstatten).
 */
export function StornoForm(props: {
  orderId: string;
  isAbo: boolean;
  /** Läuft noch etwas (offene Raten oder Abo ohne Ende)? Sonst gibt es nur „mit Rückzahlung“. */
  running: boolean;
  /** Abo zu einem späteren Tag beenden möglich (nicht bei PayPal-Abos). */
  canEndLater: boolean;
  paypalAbo: boolean;
  today: string;
  invoices: StornoInvoice[];
  currency: string;
}) {
  const [state, action, pending] = useActionState(stornoOrderAction, { message: null });
  const [kind, setKind] = useState<"" | "ohne_rueckzahlung" | "mit_rueckzahlung">("");
  const [when, setWhen] = useState<"sofort" | "datum">("sofort");
  const [picked, setPicked] = useState<string[]>(props.invoices.map((i) => i.id));
  const canRefund = props.invoices.length > 0;
  const sum = props.invoices.filter((i) => picked.includes(i.id)).reduce((t, i) => t + i.refundableCents, 0);

  return (
    <form
      action={action}
      className="product-form"
      onSubmit={(e) => {
        let text: string;
        if (kind === "mit_rueckzahlung") {
          text = `Bestellung jetzt stornieren und ${euro(sum, props.currency)} zurückzahlen? Dazu entstehen Stornorechnungen, die per E-Mail an die Kundin gehen.`;
        } else if (when === "datum") {
          text = "Abo zum gewählten Tag beenden? Bis dahin wird weiter abgebucht, Bezahltes bleibt bezahlt.";
        } else {
          text = "Bestellung jetzt beenden, ohne etwas zurückzuzahlen? Offene Raten entfallen, das Abo endet heute.";
        }
        if (!window.confirm(text)) e.preventDefault();
      }}
    >
      <input type="hidden" name="order_id" value={props.orderId} />
      <fieldset className="field">
        <legend>Was soll passieren?</legend>
        {props.running && (
          <label>
            <input type="radio" name="kind" value="ohne_rueckzahlung" checked={kind === "ohne_rueckzahlung"} onChange={() => setKind("ohne_rueckzahlung")} />{" "}
            <strong>Storno ohne Rückzahlung</strong>: {props.isAbo ? "Abo beenden" : "Restliche Raten entfallen lassen"}. Es wird nichts mehr abgebucht,
            bereits Bezahltes bleibt bezahlt.
          </label>
        )}
        {canRefund && (
          <label>
            <input type="radio" name="kind" value="mit_rueckzahlung" checked={kind === "mit_rueckzahlung"} onChange={() => setKind("mit_rueckzahlung")} />{" "}
            <strong>Storno mit Rückzahlung</strong>: Bestellung sofort beenden und Geld zurückzahlen (Stornorechnung je Rechnung).
          </label>
        )}
      </fieldset>

      {kind === "ohne_rueckzahlung" && props.isAbo && (
        <fieldset className="field">
          <legend>Wann endet das Abo?</legend>
          <label>
            <input type="radio" name="when" value="sofort" checked={when === "sofort"} onChange={() => setWhen("sofort")} /> Sofort (heute)
          </label>
          {props.canEndLater ? (
            <label>
              <input type="radio" name="when" value="datum" checked={when === "datum"} onChange={() => setWhen("datum")} /> Zum Ende der Laufzeit am{" "}
              <input name="ends_on" type="date" min={props.today} disabled={when !== "datum"} required={when === "datum"} aria-label="Letzter Tag der Laufzeit" />
            </label>
          ) : (
            <p className="note">PayPal-Abos enden sofort; das Abo wird dabei auch bei PayPal gekündigt.</p>
          )}
        </fieldset>
      )}

      {kind === "mit_rueckzahlung" && (
        <fieldset className="field">
          <legend>Welche Rechnungen werden erstattet?</legend>
          {props.invoices.map((i) => (
            <label key={i.id}>
              <input
                type="checkbox"
                name="invoice_id"
                value={i.id}
                checked={picked.includes(i.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))}
              />{" "}
              {i.number}: {euro(i.refundableCents, props.currency)}
            </label>
          ))}
          <p className="note">
            Zusammen {euro(sum, props.currency)}. Das Geld geht auf dem Zahlweg zurück, mit dem die Kundin bezahlt hat. Nur einen Teilbetrag zurückzahlen: unten bei
            „Rechnungen“ den Betrag eintragen.
          </p>
        </fieldset>
      )}

      {kind && (
        <div className="field">
          <label htmlFor="storno_reason">Grund</label>
          <input id="storno_reason" name="reason" type="text" required placeholder="z. B. Widerruf vom 03.11., Kulanz, Kündigung" />
        </div>
      )}

      <div className="form-actions">
        <button type="submit" disabled={pending || !kind || (kind === "mit_rueckzahlung" && picked.length === 0)}>
          {pending ? "Läuft …" : kind === "mit_rueckzahlung" ? "Stornieren und zurückzahlen" : "Stornieren ohne Rückzahlung"}
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
