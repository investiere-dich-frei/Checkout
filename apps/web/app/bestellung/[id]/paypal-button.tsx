"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useState } from "react";

/** PayPal als eigene Zahlungsart. Nur der PayPal-Knopf, Karten laufen über Stripe. */
export function PaypalButton(props: { clientId: string; currency: string; orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <p className="note">Danke, deine Zahlung mit PayPal ist eingegangen. Die Seite wird aktualisiert …</p>;

  return (
    <PayPalScriptProvider
      options={{ clientId: props.clientId, currency: props.currency, intent: "capture", locale: "de_DE", components: "buttons" }}
    >
      <PayPalButtons
        fundingSource="paypal"
        style={{ layout: "vertical", label: "pay", height: 48 }}
        createOrder={async () => {
          setError(null);
          const res = await fetch("/api/paypal/order", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: props.orderId }),
          });
          const body = (await res.json()) as { id?: string; error?: string };
          if (!res.ok || !body.id) throw new Error(body.error ?? "PayPal ist gerade nicht erreichbar");
          return body.id;
        }}
        onApprove={async (data) => {
          const res = await fetch("/api/paypal/capture", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ paypalOrderId: data.orderID }),
          });
          const body = (await res.json()) as { outcome?: string; status?: string; error?: string };
          if (!res.ok) {
            setError(body.error ?? "Die Zahlung mit PayPal hat nicht geklappt. Bitte versuche es noch einmal.");
            return;
          }
          setDone(true);
          window.location.reload();
        }}
        onError={() => setError("Die Zahlung mit PayPal hat nicht geklappt. Bitte versuche es noch einmal.")}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </PayPalScriptProvider>
  );
}
