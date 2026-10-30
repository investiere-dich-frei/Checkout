"use client";

import { useActionState } from "react";
import { refundInvoiceAction } from "../../actions";

export function RefundForm(props: { orderId: string; invoiceId: string; invoiceNumber: string }) {
  const [state, action, pending] = useActionState(refundInvoiceAction, { message: null });
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        if (!window.confirm(`Rechnung ${props.invoiceNumber} voll erstatten und stornieren?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="order_id" value={props.orderId} />
      <input type="hidden" name="invoice_id" value={props.invoiceId} />
      <label htmlFor={`reason-${props.invoiceId}`}>Grund der Erstattung von {props.invoiceNumber}</label>
      <input id={`reason-${props.invoiceId}`} name="reason" type="text" required placeholder="z. B. Widerruf vom 03.11." />
      <button type="submit" disabled={pending}>
        {pending ? "Läuft …" : "Erstatten und stornieren"}
      </button>
      {state.message && (
        <p role="status" style={{ flexBasis: "100%" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
