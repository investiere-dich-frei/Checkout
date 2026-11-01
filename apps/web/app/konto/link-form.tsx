"use client";

import { useActionState } from "react";
import { requestPortalLinkAction } from "./actions";

export function PortalLinkForm() {
  const [state, action, pending] = useActionState(requestPortalLinkAction, { sent: false });
  if (state.sent) {
    return <p>Wenn es zu dieser Adresse Bestellungen gibt, bekommst du gleich eine E-Mail mit dem Link zu deinem Kundenbereich.</p>;
  }
  return (
    <form action={action}>
      <label htmlFor="email">E-Mail-Adresse deiner Bestellung</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <button className="order" type="submit" disabled={pending} style={{ marginTop: 16 }}>
        Link schicken
      </button>
    </form>
  );
}
