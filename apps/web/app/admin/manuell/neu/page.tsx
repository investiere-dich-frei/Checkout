import { canChange } from "@idf/db/admin";
import { canCreateManual, manualOrderFormData } from "@idf/db/manual-orders";
import { redirect } from "next/navigation";
import { pool } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";
import { requireUser } from "../../../../lib/session";
import { ManualOrderForm } from "./manual-order-form";

export default async function NewManualOrderPage() {
  const user = await requireUser();
  if (!canCreateManual(user)) redirect("/admin/manuell");
  const data = await manualOrderFormData(pool());
  return (
    <section className="card">
      <p>
        <a href="/admin/manuell">← Manuelle Bestellungen</a>
      </p>
      <h1>Neue Bestellung per Rechnung</h1>
      <p className="note">
        Für Kundinnen, die erst eine Rechnung möchten und dann überweisen. Die Rechnung bekommt sofort eine Nummer aus dem Kreis IDF und geht mit
        Bankverbindung, Zahlungsplan, Widerrufsbelehrung und AGB an die Kundin. Der Kurszugang startet erst, wenn die Zahlung verbucht ist.
      </p>
      {!data.bankConfigured ? (
        <p className="notice-box">Für die Gesellschaft ist noch keine Bankverbindung hinterlegt. Bitte Christian Bescheid geben.</p>
      ) : (
        <ManualOrderForm
          products={data.products.map((p) => ({ id: p.id, name: p.name, active: p.active, steuerfrei: p.tax_category === "steuerfrei_4_21", prices: p.prices }))}
          sellers={canChange(user) ? data.sellers : null}
          canBook={canChange(user)}
          today={todayBerlin()}
          ownUserId={user.id}
        />
      )}
    </section>
  );
}
