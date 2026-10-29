import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Stripe from "stripe";
import { toEventInput } from "../lib/stripe-event";

// Ausgedachtes Ereignis und Testschlüssel, keine echten Daten.
const api = new Stripe("sk_test_nur_fuer_tests");
const secret = "whsec_nur_fuer_tests";

const payload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "payment_intent.succeeded",
  created: 1793660000,
  data: {
    object: {
      id: "pi_test_1",
      object: "payment_intent",
      status: "succeeded",
      amount: 59500,
      amount_received: 59500,
      currency: "eur",
      metadata: { installment_id: "00000000-0000-0000-0000-000000000001" },
    },
  },
});

describe("Stripe-Meldungen", () => {
  it("nimmt nur Meldungen mit gültiger Signatur an", () => {
    const header = api.webhooks.generateTestHeaderString({ payload, secret });
    const event = api.webhooks.constructEvent(payload, header, secret);
    assert.equal(event.id, "evt_test_1");
    assert.throws(() => api.webhooks.constructEvent(payload, header, "whsec_falsch"));
    assert.throws(() => api.webhooks.constructEvent(payload.replace("59500,", "1,"), header, secret));
  });

  it("liest Betrag, Währung und Fälligkeit aus der Zahlungsabsicht", () => {
    const header = api.webhooks.generateTestHeaderString({ payload, secret });
    const input = toEventInput(api.webhooks.constructEvent(payload, header, secret));
    assert.deepEqual(input.paymentIntent, {
      id: "pi_test_1",
      status: "succeeded",
      amountReceived: 59500,
      currency: "eur",
      metadata: { installment_id: "00000000-0000-0000-0000-000000000001" },
    });
    assert.equal(input.created, 1793660000);
  });

  it("lässt andere Ereignisse ohne Zahlungsabsicht durch", () => {
    const other = JSON.stringify({ id: "evt_test_2", object: "event", type: "customer.created", created: 1, data: { object: { id: "cus_1" } } });
    const header = api.webhooks.generateTestHeaderString({ payload: other, secret });
    const input = toEventInput(api.webhooks.constructEvent(other, header, secret));
    assert.equal(input.paymentIntent, undefined);
    assert.equal(input.type, "customer.created");
  });
});
