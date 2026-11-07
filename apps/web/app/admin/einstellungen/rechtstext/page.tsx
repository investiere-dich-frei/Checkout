import { canSeeAll } from "@idf/db/admin";
import { legalVersionContent } from "@idf/db/settings";
import { notFound, redirect } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_LABEL: Record<string, string> = { agb: "AGB", datenschutz: "Datenschutzerklärung", widerruf: "Widerrufsbelehrung" };

export default async function LegalTextPage(props: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { id } = await props.searchParams;
  if (!id || !UUID.test(id)) notFound();
  const v = await legalVersionContent(pool(), id);
  if (!v) notFound();
  return (
    <section className="card">
      <p>
        <a href="/admin/einstellungen">Zurück zu den Einstellungen</a>
      </p>
      <h1>
        {KIND_LABEL[v.kind] ?? v.kind}, Fassung {v.version}
      </h1>
      <pre className="legal-text">{v.content}</pre>
    </section>
  );
}
