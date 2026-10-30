import Stripe from "stripe";

// Schlüssel kommen aus der Umgebung (auf dem Server aus SOPS), nie aus dem Code.
const globalForStripe = globalThis as unknown as { idfStripe?: Stripe };

/** Stripe-Zugang, oder null, solange keine Schlüssel hinterlegt sind. */
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  globalForStripe.idfStripe ??= new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "idf-checkout" } });
  return globalForStripe.idfStripe;
}

export function publishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}
