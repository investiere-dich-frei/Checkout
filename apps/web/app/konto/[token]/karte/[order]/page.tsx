import { cardChangeTarget, portalEmail } from "@idf/db/customer-portal";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { chargeNow } from "../../../../../lib/charging";
import { pool } from "../../../../../lib/db";
import { todayBerlin } from "../../../../../lib/format";
import { completeCardSetup, ensureStripeCustomer } from "../../../../../lib/payment";
import { paypal } from "../../../../../lib/paypal";
import { publishableKey, stripe } from "../../../../../lib/stripe";
import { CardSetupForm } from "../../../../bestellung/[id]/payment-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Karte ändern – Investiere Dich Frei", robots: { index: false } };

/**
 * Karte bzw. Zahlungsart für Raten und Abos ändern. Neue Zahlungsart per SetupIntent bei Stripe
 * (nichts wird abgebucht); die neueste gespeicherte gilt für die folgenden Einzüge. Ist eine fällige
 * Rate fehlgeschlagen, wird sie danach gleich mit der neuen Karte eingezogen.
 */
export default async function CardChangePage(props: {
  params: Promise<{ token: string; order: string }>;
  searchParams: Promise<{ setup_intent?: string; redirect_status?: string }>;
}) {
  const { token, order } = await props.params;
  const { setup_intent, redirect_status } = await props.searchParams;
  const email = await portalEmail(pool(), token);
  if (!email) redirect("/konto?abgelaufen=1");
  const back = `/konto/${token}`;
  const today = todayBerlin();
  const target = await cardChangeTarget(pool(), email, order, today);
  const api = stripe();
  const key = publishableKey();
  if (!target || !api || !key) {
    return (
      <section className="card">
        <h1>Karte ändern</h1>
        <p>Für diese Bestellung lässt sich die Zahlungsart gerade nicht ändern. Schreib uns gern an buchhaltung@investieredichfrei.de.</p>
        <p>
          <a href={back}>Zurück zum Kundenbereich</a>
        </p>
      </section>
    );
  }

  if (setup_intent && redirect_status === "succeeded") {
    let saved = false;
    let charged: string | null = null;
    try {
      saved = await completeCardSetup(api, order, setup_intent);
      if (saved && target.failedInstallmentId) {
        const r = await chargeNow(pool(), { stripe: api, paypal: paypal() }, target.failedInstallmentId, today, "kundin:kundenbereich");
        charged = r.ok ? r.outcome : null;
      }
    } catch (err) {
      console.error("Kartenwechsel nicht abgeschlossen", (err as Error).message);
    }
    return (
      <section className="card">
        <h1>Karte ändern</h1>
        {saved ? (
          <p>
            Danke, deine neue Zahlungsart ist gespeichert. Die nächsten Zahlungen werden damit eingezogen.
            {charged === "gebucht" || charged === "eingereicht" ? " Die offene Zahlung haben wir gerade eingezogen; die Rechnung kommt per E-Mail." : ""}
            {charged === "abgelehnt" ? " Die offene Zahlung wurde leider abgelehnt. Bitte versuche eine andere Karte." : ""}
          </p>
        ) : (
          <p className="error">Das Speichern hat nicht geklappt. Bitte versuche es noch einmal.</p>
        )}
        <p>
          <a href={back}>Zurück zum Kundenbereich</a>
        </p>
      </section>
    );
  }

  const customer = await ensureStripeCustomer(api, target);
  const intent = await api.setupIntents.create({
    customer,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: { order_id: order, zweck: "kartenwechsel" },
  });
  return (
    <section className="card">
      <h1>Karte ändern</h1>
      <p className="note">Heute wird nichts abgebucht{target.failedInstallmentId ? ", außer der offenen, schon fälligen Zahlung" : ""}. Die neue Zahlungsart gilt für die folgenden Zahlungen dieser Bestellung.</p>
      {redirect_status === "failed" && (
        <p className="error" role="alert">
          Das Hinterlegen hat nicht geklappt. Bitte versuche es noch einmal.
        </p>
      )}
      <div className="pay-option">
        <CardSetupForm publishableKey={key} clientSecret={intent.client_secret!} orderId={order} returnPath={`/konto/${token}/karte/${order}`} />
      </div>
      <p>
        <a href={back}>Zurück zum Kundenbereich</a>
      </p>
    </section>
  );
}
