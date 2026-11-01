"use client";

import { useActionState, useRef } from "react";
import { refundInvoiceAction } from "../../actions";

const euro = (cents: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);

/**
 * Erstattung einer Rechnung. Betrag leer = alles, was noch offen ist (ohne frühere Teilerstattung:
 * Stornorechnung). Ein kleinerer Betrag erzeugt eine Rechnungskorrektur.
 */
export function RefundForm(props: { orderId: string; invoiceId: string; invoiceNumber: string; refundableCents: number; grossCents: number; currency: string }) {
  const [state, action, pending] = useActionState(refundInvoiceAction, { message: null });
  const amountRef = useRef<HTMLInputElement>(null);
  const partlyDone = props.refundableCents < props.grossCents;
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        const typed = amountRef.current?.value.trim();
        const text = typed
          ? `${typed} € von Rechnung ${props.invoiceNumber} erstatten? Dazu entsteht eine Rechnungskorrektur.`
          : partlyDone
            ? `Den Rest von ${euro(props.refundableCents, props.currency)} zu Rechnung ${props.invoiceNumber} erstatten?`
            : `Rechnung ${props.invoiceNumber} voll erstatten und stornieren?`;
        if (!window.confirm(text)) e.preventDefault();
      }}
    >
      <input type="hidden" name="order_id" value={props.orderId} />
      <input type="hidden" name="invoice_id" value={props.invoiceId} />
      <label htmlFor={`reason-${props.invoiceId}`}>
        Erstattung zu {props.invoiceNumber}
        {partlyDone && <> (noch erstattbar: {euro(props.refundableCents, props.currency)})</>}
      </label>
      <input id={`reason-${props.invoiceId}`} name="reason" type="text" required placeholder="Grund, z. B. Widerruf vom 03.11." />
      <input
        ref={amountRef}
        name="amount"
        type="text"
        inputMode="decimal"
        aria-label="Betrag in Euro"
        placeholder={`Betrag, leer = ${euro(props.refundableCents, props.currency)}`}
        style={{ flex: "0 1 200px" }}
      />
      <button type="submit" disabled={pending}>
        {pending ? "Läuft …" : "Erstatten"}
      </button>
      {state.message && (
        <p role="status" style={{ flexBasis: "100%" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
