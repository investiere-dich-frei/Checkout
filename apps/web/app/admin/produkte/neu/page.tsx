import { canChange } from "@idf/db/admin";
import { listAccessTemplates, listCompanies } from "@idf/db/products";
import { redirect } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/session";
import { createProductAction } from "../actions";
import { ActionForm, ProductFields } from "../forms";

export default async function NewProductPage() {
  const user = await requireUser();
  if (!canChange(user)) redirect("/admin/produkte");
  const companies = await listCompanies(pool());
  const accessTemplates = await listAccessTemplates(pool());
  return (
    <section className="card">
      <p>
        <a href="/admin/produkte">← Alle Produkte</a>
      </p>
      <h1>Neues Produkt</h1>
      <p className="note">
        So geht es weiter: 1. Produkt speichern, 2. Preisoption anlegen (Einmalzahlung, Raten, Anzahlung oder Abo), 3. Steuer bestätigen, 4. freischalten.
        Erst dann funktionieren die Kauflinks.
      </p>
      <ActionForm action={createProductAction} submit="Produkt speichern">
        <ProductFields isNew companies={companies} accessTemplates={accessTemplates} values={{ name: "", slug: "", internalLabel: "", taxCategory: "standard", immediateAccess: false }} />
      </ActionForm>
    </section>
  );
}
