import { canChange } from "@idf/db/admin";
import { DEFAULT_CONTENT, getStoredPage, listImages, listPageOverview, productOffers, resolvePage } from "@idf/db/checkout-pages";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/session";
import { PageEditor } from "./editor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ vorlage?: string }> }) {
  const user = await requireUser();
  if (!canChange(user)) {
    return (
      <section className="card">
        <p>Kaufseiten gestalten dürfen nur Admins.</p>
      </section>
    );
  }
  const { id } = await props.params;
  const { vorlage } = await props.searchParams;
  const isStandard = id === "standard";
  if (!isStandard && !UUID.test(id)) notFound();
  const db = pool();

  const offers = isStandard ? null : await productOffers(db, id);
  if (!isStandard && !offers) notFound();
  const stored = await getStoredPage(db, isStandard ? null : id);

  // Ausgangspunkt: gewählte Vorlage, sonst die gespeicherte Seite, sonst das, was der Checkout gerade zeigt.
  let initial = stored?.content ?? (isStandard ? DEFAULT_CONTENT : await resolvePage(db, id));
  let templateName: string | null = null;
  const overview = await listPageOverview(db);
  const templates = overview.filter((r) => r.hasOwnPage && r.productId !== id);
  if (vorlage === "standard" && !isStandard) {
    initial = (await getStoredPage(db, null))?.content ?? DEFAULT_CONTENT;
    templateName = "Standardseite";
  } else if (vorlage && UUID.test(vorlage)) {
    const t = await getStoredPage(db, vorlage);
    if (t) {
      initial = t.content;
      templateName = overview.find((r) => r.productId === vorlage)?.name ?? "anderes Produkt";
    }
  }

  const images = await listImages(db);
  const name = isStandard ? "Standardseite" : offers!.name;
  const links = !isStandard && offers!.slug ? offers!.options.map((o) => ({ label: o.label, href: `/kaufen/${offers!.slug}/${o.id}` })) : [];

  return (
    <>
      <section className="card">
        <p>
          <a href="/admin/seiten">← Alle Kaufseiten</a>
        </p>
        <h1>Kaufseite: {name}</h1>
        {isStandard ? (
          <p className="note">Diese Seite gilt für alle Produkte ohne eigene Seite. Ihr Logo erscheint auch auf Seiten ohne eigenes Logo.</p>
        ) : stored ? (
          <p className="note">Dieses Produkt hat eine eigene Seite.</p>
        ) : (
          <p className="note">Dieses Produkt zeigt bisher die Standardseite. Mit „Speichern“ bekommt es eine eigene.</p>
        )}
        {templateName && (
          <p className="notice-box" role="status">
            Inhalt von „{templateName}“ übernommen. Er gilt erst, wenn du speicherst.
          </p>
        )}
        <form method="get" className="inline-form">
          <label htmlFor="vorlage">Inhalt einer anderen Seite als Vorlage übernehmen</label>
          <select id="vorlage" name="vorlage" defaultValue="">
            <option value="" disabled>
              Seite wählen …
            </option>
            {!isStandard && <option value="standard">Standardseite</option>}
            {templates.map((t) => (
              <option key={t.productId} value={t.productId}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="submit">Übernehmen</button>
        </form>
        {links.length > 0 && (
          <p className="note">
            Echte Kaufseite ansehen:{" "}
            {links.map((l, i) => (
              <span key={l.href}>
                {i > 0 && " · "}
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              </span>
            ))}
          </p>
        )}
      </section>
      <PageEditor
        key={`${id}-${vorlage ?? ""}`}
        target={isStandard ? "standard" : id}
        productName={isStandard ? "Produktname" : offers!.name}
        optionLabel={isStandard ? "Preisoption" : (offers!.options[0]?.label ?? "Preisoption")}
        initial={initial}
        images={images.map((i) => ({ id: i.id, name: i.name }))}
      />
    </>
  );
}
