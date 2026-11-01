import { centsToPaypalAmount, paypalAmountToCents, type PaypalCaptureInput } from "@idf/db/paypal";

/**
 * Schmaler Zugang zur PayPal-REST-Schnittstelle (Orders v2). Zugangsdaten kommen aus
 * der Umgebung (auf dem Server aus SOPS), nie aus dem Code.
 */

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  webhookId: string | null;
}

export function paypalConfig(env: Record<string, string | undefined> = process.env): PaypalConfig | null {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
  return {
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    // Ohne ausdrückliches „live“ immer die Testumgebung.
    baseUrl: isPaypalLive(env) ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    webhookId: env.PAYPAL_WEBHOOK_ID || null,
  };
}

/** Echte Zahlungen nur mit ausdrücklichem PAYPAL_ENV=live, sonst Sandbox. */
export function isPaypalLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.PAYPAL_ENV === "live";
}

export class PaypalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class PaypalApi {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: PaypalConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchFn(`${this.config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PaypalError("PayPal-Anmeldung fehlgeschlagen", res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T>(path: string, body: unknown, requestId?: string): Promise<T> {
    const res = await this.fetchFn(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
        ...(requestId ? { "paypal-request-id": requestId } : {}),
      },
      body: JSON.stringify(body),
    });
    // Fehlertexte von PayPal nicht weiterreichen: Sie können Kundendaten enthalten.
    if (!res.ok) throw new PaypalError(`PayPal antwortet mit ${res.status} auf ${path}`, res.status);
    return (await res.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.config.baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
    });
    if (!res.ok) throw new PaypalError(`PayPal antwortet mit ${res.status} auf ${path.split("?")[0]}`, res.status);
    return (await res.json()) as T;
  }

  /** PayPal-Abo (I-…) lesen: Status und nächste Abbuchung. */
  getSubscription(id: string): Promise<PaypalSubscription> {
    if (!/^I-[A-Z0-9]{6,30}$/.test(id)) throw new PaypalError("Ungültige PayPal-Abo-ID", 400);
    return this.get(`/v1/billing/subscriptions/${id}`);
  }

  /** Zahlungen eines PayPal-Abos im Zeitraum. */
  async subscriptionTransactions(id: string, from: Date, to: Date): Promise<PaypalSubscriptionTransaction[]> {
    if (!/^I-[A-Z0-9]{6,30}$/.test(id)) throw new PaypalError("Ungültige PayPal-Abo-ID", 400);
    const q = new URLSearchParams({ start_time: from.toISOString(), end_time: to.toISOString() });
    const r = await this.get<{ transactions?: PaypalSubscriptionTransaction[] }>(`/v1/billing/subscriptions/${id}/transactions?${q}`);
    return r.transactions ?? [];
  }

  /** PayPal-Bestellung für eine Fälligkeit anlegen. */
  createOrder(input: {
    installmentId: string;
    amountCents: number;
    currency: string;
    description: string;
    brandName: string;
    /** Raten und Abos: PayPal-Konto für spätere Einzüge speichern. */
    vault: boolean;
    requestId: string;
  }): Promise<{ id: string; status: string }> {
    return this.call(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.installmentId,
            custom_id: input.installmentId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency.toUpperCase(), value: centsToPaypalAmount(input.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: input.brandName.slice(0, 127),
              locale: "de-DE",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
            },
            ...(input.vault
              ? { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } } }
              : {}),
          },
        },
      },
      input.requestId,
    );
  }

  /** Von der Kundin freigegebene Bestellung einziehen. */
  async captureOrder(paypalOrderId: string): Promise<PaypalOrderResponse> {
    if (!/^[A-Z0-9]{5,40}$/.test(paypalOrderId)) throw new PaypalError("Ungültige PayPal-Bestellnummer", 400);
    return this.call(`/v2/checkout/orders/${paypalOrderId}/capture`, {}, `einzug-${paypalOrderId}`);
  }

  /** Weitere Zahlung über ein gespeichertes PayPal-Konto (Vault), ohne Zutun der Kundin. */
  chargeVault(input: {
    vaultId: string;
    installmentId: string;
    amountCents: number;
    currency: string;
    description: string;
    requestId: string;
  }): Promise<PaypalOrderResponse> {
    return this.call(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.installmentId,
            custom_id: input.installmentId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency.toUpperCase(), value: centsToPaypalAmount(input.amountCents) },
          },
        ],
        payment_source: { paypal: { vault_id: input.vaultId } },
      },
      input.requestId,
    );
  }

  /** Zahlung (Capture) voll erstatten. */
  async refundCapture(captureId: string, requestId: string): Promise<{ id: string; status: string }> {
    if (!/^[A-Z0-9]{5,40}$/.test(captureId)) throw new PaypalError("Ungültige PayPal-Zahlungsnummer", 400);
    return this.call(`/v2/payments/captures/${captureId}/refund`, {}, requestId);
  }

  /** Signatur einer Webhook-Meldung bei PayPal prüfen lassen. */
  async verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
    if (!this.config.webhookId) return false;
    const h = (name: string) => headers.get(name) ?? "";
    const res = await this.call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: this.config.webhookId,
      webhook_event: event,
    });
    return res.verification_status === "SUCCESS";
  }
}

export interface PaypalSubscription {
  id: string;
  status: string;
  billing_info?: { next_billing_time?: string };
}

export interface PaypalSubscriptionTransaction {
  id: string;
  status: string;
  amount_with_breakdown?: { gross_amount?: { currency_code: string; value: string } };
  time?: string;
}

/** Sale aus der Webhook-Meldung PAYMENT.SALE.* eines PayPal-Abos. */
export interface PaypalSale {
  id: string;
  state: string;
  amount: { total: string; currency: string };
  billing_agreement_id?: string;
  create_time?: string;
}

export interface PaypalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  custom_id?: string;
  create_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
}

export interface PaypalOrderResponse {
  id: string;
  status: string;
  payment_source?: { paypal?: { attributes?: { vault?: { id?: string; status?: string } } } };
  purchase_units?: { payments?: { captures?: PaypalCapture[] } }[];
}

function toCapture(c: PaypalCapture): NonNullable<PaypalCaptureInput["capture"]> {
  return {
    id: c.id,
    status: c.status,
    amountCents: paypalAmountToCents(c.amount.value),
    currency: c.amount.currency_code,
    customId: c.custom_id ?? null,
    createdAt: c.create_time ? new Date(c.create_time) : new Date(),
  };
}

/** Antwort auf den Einzug in die Werte für die Verbuchung übersetzen. */
export function captureFromOrder(order: PaypalOrderResponse, live = isPaypalLive()): PaypalCaptureInput {
  const c = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    eventId: c ? `capture:${c.id}` : `bestellung:${order.id}:${order.status}`,
    type: "capture",
    paypalOrderId: order.id,
    capture: c ? toCapture(c) : null,
    vaultId: order.payment_source?.paypal?.attributes?.vault?.status === "VAULTED" ? (order.payment_source.paypal.attributes.vault.id ?? null) : null,
    payload: order,
    live,
  };
}

export interface PaypalWebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: unknown;
}

/** Webhook-Meldung in die Werte für die Verbuchung übersetzen. Nur Zahlungs-Ereignisse tragen eine Zahlung. */
export function captureFromWebhook(event: PaypalWebhookEvent, live = isPaypalLive()): PaypalCaptureInput {
  const isCapture = event.event_type.startsWith("PAYMENT.CAPTURE.") && event.resource_type === "capture";
  const c = isCapture ? (event.resource as PaypalCapture) : null;
  return {
    eventId: event.id,
    type: event.event_type,
    paypalOrderId: c?.supplementary_data?.related_ids?.order_id ?? null,
    capture: c ? toCapture(c) : null,
    payload: event,
    live,
  };
}

const globalForPaypal = globalThis as unknown as { idfPaypal?: PaypalApi };

/** PayPal-Zugang, oder null, solange keine Zugangsdaten hinterlegt sind. */
export function paypal(): PaypalApi | null {
  const config = paypalConfig();
  if (!config) return null;
  globalForPaypal.idfPaypal ??= new PaypalApi(config);
  return globalForPaypal.idfPaypal;
}
