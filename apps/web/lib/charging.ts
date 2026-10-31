import { dueCharges, extendSubscriptions, recordChargeAttempt, type DueCharge } from "@idf/db/billing";
import { handlePaypalCapture, rememberPaypalOrder } from "@idf/db/paypal";
import { rememberPaymentIntent } from "@idf/db/stripe";
import type pg from "pg";
import type Stripe from "stripe";
import { captureFromOrder, type PaypalApi } from "./paypal";

/**
 * Täglicher Einzug: Abos verlängern, dann jede fällige Rate über die gespeicherte
 * Zahlungsart einziehen. Gibt nur Zahlen zurück, keine Kundendaten.
 */

export interface ChargeRun {
  extended: number;
  due: number;
  submitted: number;
  booked: number;
  declined: number;
  withoutMethod: number;
  errors: number;
}

async function inTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', 'system:einzug', true)`);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function chargeStripe(pool: pg.Pool, api: Stripe, d: DueCharge, run: ChargeRun) {
  const m = d.method!;
  // Erst anlegen und merken, dann bestätigen: So kennt der Webhook die Zahlung immer schon.
  // off_session gehört nur an die Bestätigung; Stripe lehnt es beim Anlegen ohne confirm ab.
  let intent: Stripe.PaymentIntent;
  try {
    intent = await api.paymentIntents.create(
      {
        amount: d.grossCents,
        currency: d.currency.toLowerCase(),
        customer: m.providerCustomer ?? undefined,
        payment_method: m.ref,
        metadata: { installment_id: d.installmentId, order_id: d.orderId, seq: String(d.seq) },
      },
      { idempotencyKey: `einzug-${d.installmentId}-${d.attempts + 1}` },
    );
  } catch (err) {
    // Anlegen gescheitert (z. B. ungültige Anfrage, Stripe nicht erreichbar): als Fehlversuch
    // festhalten. So steht er im Protokoll, und der nächste Lauf nutzt einen neuen Schlüssel.
    const code = (err as { code?: string }).code ?? (err as { type?: string }).type ?? "unbekannt";
    await inTx(pool, (c) => recordChargeAttempt(c, { installmentId: d.installmentId, provider: "stripe", providerRef: null, outcome: "fehler", errorCode: code }));
    console.error(`Einzug für Fälligkeit ${d.installmentId}: Anlegen bei Stripe fehlgeschlagen:`, (err as Error).message);
    run.errors++;
    return;
  }
  await inTx(pool, (c) => rememberPaymentIntent(c, { id: intent.id, installmentId: d.installmentId, amountCents: intent.amount, currency: intent.currency }));
  try {
    const confirmed = await api.paymentIntents.confirm(intent.id, { off_session: true }, { idempotencyKey: `bestaetigung-${intent.id}` });
    const ok = confirmed.status === "succeeded" || confirmed.status === "processing";
    await inTx(pool, (c) =>
      recordChargeAttempt(c, {
        installmentId: d.installmentId,
        provider: "stripe",
        providerRef: intent.id,
        outcome: ok ? "eingereicht" : "abgelehnt",
        errorCode: ok ? null : confirmed.status,
      }),
    );
    if (ok) run.submitted++;
    else run.declined++;
  } catch (err) {
    // Karte abgelehnt, Authentifizierung nötig o. Ä.: Stripe liefert einen Code, keine Kundendaten.
    const code = (err as { code?: string; decline_code?: string }).decline_code ?? (err as { code?: string }).code ?? "unbekannt";
    const declined = (err as { type?: string }).type === "StripeCardError";
    await inTx(pool, (c) =>
      recordChargeAttempt(c, { installmentId: d.installmentId, provider: "stripe", providerRef: intent.id, outcome: declined ? "abgelehnt" : "fehler", errorCode: code }),
    );
    if (declined) run.declined++;
    else run.errors++;
  }
}

async function chargePaypal(pool: pg.Pool, api: PaypalApi, d: DueCharge, run: ChargeRun) {
  const m = d.method!;
  let order;
  try {
    order = await api.chargeVault({
      vaultId: m.ref,
      installmentId: d.installmentId,
      amountCents: d.grossCents,
      currency: d.currency,
      description: `Zahlung ${d.seq}`,
      requestId: `einzug-${d.installmentId}-${d.attempts + 1}`,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    await inTx(pool, (c) =>
      recordChargeAttempt(c, { installmentId: d.installmentId, provider: "paypal", providerRef: null, outcome: status === 422 ? "abgelehnt" : "fehler", errorCode: String(status ?? "unbekannt") }),
    );
    if (status === 422) run.declined++;
    else run.errors++;
    return;
  }
  const input = captureFromOrder(order);
  const outcome = await inTx(pool, async (c) => {
    await rememberPaypalOrder(c, { id: order.id, installmentId: d.installmentId, amountCents: d.grossCents, currency: d.currency });
    const handled = await handlePaypalCapture(c, input);
    const status = input.capture?.status;
    const result = handled.outcome === "gebucht" || handled.outcome === "schon_gebucht" ? "gebucht" : status === "PENDING" ? "eingereicht" : "abgelehnt";
    await recordChargeAttempt(c, { installmentId: d.installmentId, provider: "paypal", providerRef: order.id, outcome: result, errorCode: result === "abgelehnt" ? (status ?? order.status) : null });
    return result;
  });
  if (outcome === "gebucht") run.booked++;
  else if (outcome === "eingereicht") run.submitted++;
  else run.declined++;
}

export async function runCharging(pool: pg.Pool, apis: { stripe: Stripe | null; paypal: PaypalApi | null }, today: string): Promise<ChargeRun> {
  const run: ChargeRun = { extended: 0, due: 0, submitted: 0, booked: 0, declined: 0, withoutMethod: 0, errors: 0 };
  run.extended = await inTx(pool, (c) => extendSubscriptions(c, today));
  const due = await dueCharges(pool, today);
  run.due = due.length;
  for (const d of due) {
    if (!d.method) {
      // Keine gespeicherte Zahlungsart: Die Kundin zahlt über die Bestellseite (Mahnwesen schickt den Link).
      run.withoutMethod++;
      continue;
    }
    try {
      if (d.method.provider === "stripe" && apis.stripe) await chargeStripe(pool, apis.stripe, d, run);
      else if (d.method.provider === "paypal" && apis.paypal) await chargePaypal(pool, apis.paypal, d, run);
      else run.withoutMethod++;
    } catch (err) {
      console.error(`Einzug für Fälligkeit ${d.installmentId} fehlgeschlagen:`, (err as Error).message);
      run.errors++;
    }
  }
  return run;
}
