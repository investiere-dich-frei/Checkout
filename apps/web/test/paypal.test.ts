import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureFromOrder, captureFromWebhook, PaypalApi, paypalConfig, PaypalError } from "../lib/paypal";

// Ausgedachte Zugangsdaten und Antworten, keine echten Daten.
const config = { clientId: "id", clientSecret: "geheim", baseUrl: "https://paypal.test", webhookId: "WH-ID" };

function fakeFetch(responses: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(responses[path] ?? {}), { status: status[path] ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const TOKEN = { "/v1/oauth2/token": { access_token: "tok", expires_in: 3600 } };

describe("PayPal-Zugang", () => {
  it("nutzt ohne ausdrückliches live die Testumgebung", () => {
    assert.equal(paypalConfig({}), null);
    assert.equal(paypalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })?.baseUrl, "https://api-m.sandbox.paypal.com");
    assert.equal(
      paypalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", PAYPAL_ENV: "live" })?.baseUrl,
      "https://api-m.paypal.com",
    );
  });

  it("legt die Bestellung mit Betrag, Fälligkeit und gespeichertem Konto für Raten an", async () => {
    const f = fakeFetch({ ...TOKEN, "/v2/checkout/orders": { id: "PP1", status: "PAYER_ACTION_REQUIRED" } });
    const api = new PaypalApi(config, f.fn);
    const r = await api.createOrder({
      installmentId: "inst-1",
      amountCents: 166567,
      currency: "eur",
      description: "Coaching – 3 Raten (Zahlung 1 von 3)",
      brandName: "Test GmbH",
      vault: true,
      requestId: "req-1",
    });
    assert.equal(r.id, "PP1");
    const call = f.calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
    const body = JSON.parse(String(call.init.body));
    assert.deepEqual(body.purchase_units[0].amount, { currency_code: "EUR", value: "1665.67" });
    assert.equal(body.purchase_units[0].custom_id, "inst-1");
    assert.equal(body.payment_source.paypal.attributes.vault.store_in_vault, "ON_SUCCESS");
    assert.equal((call.init.headers as Record<string, string>)["paypal-request-id"], "req-1");

    // Der Zugangsschlüssel wird wiederverwendet.
    await api.createOrder({ installmentId: "i", amountCents: 100, currency: "EUR", description: "x", brandName: "x", vault: false, requestId: "r" });
    assert.equal(f.calls.filter((c) => c.url.endsWith("/v1/oauth2/token")).length, 1);
  });

  it("meldet Fehler ohne PayPal-Fehlertext und prüft die Bestellnummer", async () => {
    const f = fakeFetch({ ...TOKEN, "/v2/checkout/orders/ABC12/capture": { message: "Name der Kundin" } }, { "/v2/checkout/orders/ABC12/capture": 422 });
    const api = new PaypalApi(config, f.fn);
    await assert.rejects(api.captureOrder("ABC12"), (e: unknown) => e instanceof PaypalError && e.status === 422 && !e.message.includes("Kundin"));
    await assert.rejects(api.captureOrder("../../v1/x"), PaypalError);
  });

  it("übersetzt Einzug und Webhook in dieselbe Zahlung", () => {
    const capture = {
      id: "CAP1",
      status: "COMPLETED",
      amount: { currency_code: "EUR", value: "1665.67" },
      custom_id: "inst-1",
      create_time: "2026-11-02T23:30:00Z",
    };
    const direct = captureFromOrder({ id: "PP1", status: "COMPLETED", purchase_units: [{ payments: { captures: [capture] } }] });
    assert.equal(direct.eventId, "capture:CAP1");
    assert.deepEqual(direct.capture, {
      id: "CAP1",
      status: "COMPLETED",
      amountCents: 166567,
      currency: "EUR",
      customId: "inst-1",
      createdAt: new Date("2026-11-02T23:30:00Z"),
    });
    const hook = captureFromWebhook({
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: { ...capture, supplementary_data: { related_ids: { order_id: "PP1" } } },
    });
    assert.equal(hook.paypalOrderId, "PP1");
    assert.deepEqual(hook.capture, direct.capture);
    assert.equal(captureFromWebhook({ id: "WH-2", event_type: "CHECKOUT.ORDER.APPROVED", resource_type: "checkout-order" }).capture, null);
  });

  it("lässt Webhooks von PayPal prüfen und lehnt ohne Webhook-ID ab", async () => {
    const f = fakeFetch({ ...TOKEN, "/v1/notifications/verify-webhook-signature": { verification_status: "SUCCESS" } });
    const api = new PaypalApi(config, f.fn);
    assert.equal(await api.verifyWebhook(new Headers({ "paypal-transmission-id": "t1" }), { id: "WH-1" }), true);
    const body = JSON.parse(String(f.calls.at(-1)!.init.body));
    assert.equal(body.webhook_id, "WH-ID");
    assert.equal(body.transmission_id, "t1");
    assert.equal(await new PaypalApi({ ...config, webhookId: null }, f.fn).verifyWebhook(new Headers(), {}), false);
  });
});
