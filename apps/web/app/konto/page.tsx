import type { Metadata } from "next";
import { PortalLinkForm } from "./link-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kundenbereich – Investiere Dich Frei" };

export default async function PortalStart(props: { searchParams: Promise<{ abgelaufen?: string }> }) {
  const { abgelaufen } = await props.searchParams;
  return (
    <section className="card">
      <h1>Kundenbereich</h1>
      <p>Hier siehst du deine Bestellungen und Rechnungen und kannst die Karte für Raten und Abos ändern. Wir schicken dir dafür einen Link per E-Mail.</p>
      {abgelaufen && (
        <p className="error" role="alert">
          Der Link ist abgelaufen. Fordere einfach einen neuen an.
        </p>
      )}
      <PortalLinkForm />
      <p className="note" style={{ marginTop: 24 }}>
        Kündigen geht auch ohne Link: <a href="/vertraege-kuendigen">Verträge hier kündigen</a> · <a href="/vertrag-widerrufen">Vertrag widerrufen</a>
      </p>
    </section>
  );
}
