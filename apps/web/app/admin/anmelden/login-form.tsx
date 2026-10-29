"use client";

import { useActionState } from "react";
import { requestLoginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLoginAction, { sent: false });
  if (state.sent) {
    return <p>Wenn die Adresse bei uns hinterlegt ist, bekommst du gleich eine E-Mail mit einem Anmeldelink. Er gilt 15 Minuten.</p>;
  }
  return (
    <form action={action}>
      <label htmlFor="email">E-Mail-Adresse</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <button className="order" type="submit" disabled={pending} style={{ marginTop: 16 }}>
        Anmeldelink schicken
      </button>
    </form>
  );
}
