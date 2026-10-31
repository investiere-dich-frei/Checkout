"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState, type FormEvent } from "react";

function Pay(props: { orderId: string; amountLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/bestellung/${props.orderId}` },
    });
    // Nur bei einem Fehler kommt die Kundin hierher zurück; sonst leitet Stripe weiter.
    setError(error.message ?? "Die Zahlung hat nicht geklappt. Bitte versuche es noch einmal.");
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="order" type="submit" disabled={!stripe || busy} style={{ marginTop: 16 }}>
        {busy ? "Zahlung läuft …" : `Jetzt ${props.amountLabel} bezahlen`}
      </button>
    </form>
  );
}

export function PaymentForm(props: { publishableKey: string; clientSecret: string; orderId: string; amountLabel: string }) {
  const stripePromise = useMemo<Promise<Stripe | null>>(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        locale: "de",
        appearance: { theme: "stripe", variables: { colorPrimary: "#a26766", fontFamily: "Raleway, Helvetica Neue, Arial, sans-serif" } },
      }}
    >
      <Pay orderId={props.orderId} amountLabel={props.amountLabel} />
    </Elements>
  );
}

function Setup(props: { orderId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/bestellung/${props.orderId}` },
    });
    setError(error.message ?? "Das Hinterlegen hat nicht geklappt. Bitte versuche es noch einmal.");
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="order" type="submit" disabled={!stripe || busy} style={{ marginTop: 16 }}>
        {busy ? "Wird hinterlegt …" : "Zahlungsart hinterlegen"}
      </button>
    </form>
  );
}

/** Probezeit ohne Anzahlung: Zahlungsart hinterlegen, ohne dass heute etwas abgebucht wird. */
export function CardSetupForm(props: { publishableKey: string; clientSecret: string; orderId: string }) {
  const stripePromise = useMemo<Promise<Stripe | null>>(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        locale: "de",
        appearance: { theme: "stripe", variables: { colorPrimary: "#a26766", fontFamily: "Raleway, Helvetica Neue, Arial, sans-serif" } },
      }}
    >
      <Setup orderId={props.orderId} />
    </Elements>
  );
}
