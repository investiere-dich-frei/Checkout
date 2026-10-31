import { canChange, canSeeAll } from "@idf/db/admin";
import { getProduct, type PriceOptionRow } from "@idf/db/products";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents, formatRate, todayBerlin } from "../../../../lib/format";
import { previewPrice } from "../../../../lib/price-preview";
import { BASIS_LABEL, KIND_LABEL, TAX_LABEL } from "../../../../lib/product-form";
import { requireUser } from "../../../../lib/session";
import { confirmTaxAction, setPriceOptionActiveAction, setProductActiveAction, updateProductAction } from "../actions";
import { ActionForm, ProductFields } from "../forms";

const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

/** Zahlplan in Worten, z. B. „37,00 € einmalig“ oder „100,00 € heute, dann 2 × 100,00 € monatlich“. */
function describePlan(o: PriceOptionRow): string {
  const every = o.intervalMonths === 1 ? "monatlich" : o.intervalMonths === 12 ? "jährlich" : `alle ${o.intervalMonths} Monate`;
  const trial = o.trialDays ? ` (nach ${o.trialDays} Tagen Probezeit)` : "";
  if (o.kind === "einmal") return `${formatCents(o.amountCents)} einmalig`;
  const first = o.amountCents > 0 ? `${formatCents(o.amountCents)} beim Kauf, dann ` : "";
  if (o.kind === "abo") return `${first}${formatCents(o.recurringAmountCents ?? 0)} ${every}${trial}, bis zur Kündigung`;
  return `${first}${o.recurringCount} × ${formatCents(o.recurringAmountCents ?? 0)} ${every}${trial}`;
}

/** Was eine Käuferin in Deutschland zahlt, berechnet wie im Checkout. */
function exampleDe(o: PriceOptionRow, taxCategory: "standard" | "steuerfrei_4_21"): string {
  const p = previewPrice({
    plan: {
      kind: o.kind,
      amountCents: o.amountCents,
      recurringAmountCents: o.recurringAmountCents,
      recurringCount: o.recurringCount,
      intervalMonths: o.intervalMonths,
      trialDays: o.trialDays,
    },
    amountBasis: o.amountBasis,
    taxCategory,
    chVatRateBp: null,
    country: "DE",
    isBusiness: false,
    purchaseDay: todayBerlin(),
  });
  const rate = p.rateBp === 0 ? "ohne Umsatzsteuer" : `inkl. ${formatRate(p.rateBp)} USt`;
  const later = p.recurringCents !== null ? `, Folgezahlung ${formatCents(p.recurringCents)}` : "";
  const total = p.totalCents !== null && o.kind !== "einmal" ? `, gesamt ${formatCents(p.totalCents)}` : "";
  return `heute ${formatCents(p.dueNowCents)}${later}${total} (${rate})`;
}

export default async function ProductPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string; option?: string }> }) {
  const user = await requireUser();
  if (!canSeeAll(user)) redirect("/admin");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const product = await getProduct(pool(), user, id);
  if (!product) notFound();
  const edit = canChange(user);
  const activeOptions = product.options.filter((o) => o.active);
  const h = await headers();
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const v = user.salesCode ? `?v=${encodeURIComponent(user.salesCode)}` : "";

  const steps = [
    { done: !!product.slug, text: "Adresse (Slug) vergeben" },
    { done: activeOptions.length > 0, text: "Mindestens eine aktive Preisoption" },
    { done: !!product.taxConfirmedAt, text: "Steuer bestätigt" },
    { done: product.active, text: "Freigeschaltet" },
  ];

  return (
    <>
      <section className="card">
        <p>
          <a href="/admin/produkte">← Alle Produkte</a>
        </p>
        <div className="card-head">
          <h1>{product.name}</h1>
          {product.active ? <span className="badge badge-ok">freigeschaltet</span> : <span className="badge">abgeschaltet</span>}
        </div>
        {sp.neu && product.options.length === 0 && <p className="status-ok">Produkt angelegt. Als Nächstes eine Preisoption anlegen.</p>}
        {sp.option && !product.taxConfirmedAt && (
          <p className="status-ok">
            Preisoption {sp.option === "neu" ? "angelegt" : "geändert"}. Weil sich damit der Preis ändert, ist das Produkt abgeschaltet, bis du unten die Steuer bestätigst und wieder freischaltest.
          </p>
        )}
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.text} className={s.done ? "step-done" : "step-open"}>
              {s.done ? "✓" : "○"} {s.text}
            </li>
          ))}
        </ol>
        <p className="note">
          Gesellschaft: {product.companyName}
          {product.thrivecartProductId !== null && ` · aus Thrivecart übernommen (Produkt ${product.thrivecartProductId})`} · angelegt {dateTime.format(product.createdAt)}
        </p>
        <p>
          <a href={`/admin/seiten/${product.id}`}>Kaufseite gestalten</a>
        </p>
      </section>

      <section className="card">
        <h2>Angaben zum Produkt</h2>
        {edit ? (
          <ActionForm action={updateProductAction} submit="Änderungen speichern">
            <input type="hidden" name="product_id" value={product.id} />
            <ProductFields
              isNew={false}
              values={{
                name: product.name,
                slug: product.slug ?? "",
                internalLabel: product.internalLabel ?? "",
                taxCategory: product.taxCategory,
                immediateAccess: product.immediateAccess,
              }}
            />
            <p className="note">Wird die Umsatzsteuer-Art geändert, schaltet sich das Produkt ab, bis die Steuer erneut bestätigt ist.</p>
          </ActionForm>
        ) : (
          <dl className="facts">
            <dt>Adresse</dt>
            <dd>{product.slug ?? "–"}</dd>
            <dt>Umsatzsteuer</dt>
            <dd>{TAX_LABEL[product.taxCategory]}</dd>
            <dt>Sofortzugang</dt>
            <dd>{product.immediateAccess ? "ja" : "nein"}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Preisoptionen</h2>
          {edit && (
            <a className="button-link" href={`/admin/produkte/${product.id}/optionen/neu`}>
              Neue Preisoption
            </a>
          )}
        </div>
        {product.options.length === 0 ? (
          <p>Noch keine Preisoption. Ohne Preisoption kann das Produkt nicht verkauft werden.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Zahlplan</th>
                  <th>Preise</th>
                  <th>Verkauft</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {product.options.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.label}
                      <br />
                      <span className="note">{KIND_LABEL[o.kind]}</span>
                    </td>
                    <td>{describePlan(o)}</td>
                    <td>{o.amountBasis}</td>
                    <td>{o.sold}</td>
                    <td>
                      {o.active ? "aktiv" : "aus"}
                      {edit && (
                        <div className="row-actions">
                          {o.sold === 0 ? (
                            <a href={`/admin/produkte/${product.id}/optionen/${o.id}`}>Ändern</a>
                          ) : (
                            <span className="note" title="Verkaufte Preisoptionen bleiben fest. Für einen neuen Preis eine neue Preisoption anlegen.">
                              fest (verkauft)
                            </span>
                          )}
                          <ActionForm action={setPriceOptionActiveAction} submit={o.active ? "Abschalten" : "Einschalten"} className="mini-form">
                            <input type="hidden" name="option_id" value={o.id} />
                            <input type="hidden" name="active" value={o.active ? "0" : "1"} />
                          </ActionForm>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" id="steuer">
        <h2>Steuer bestätigen</h2>
        {product.taxConfirmedAt ? (
          <p className="status-ok">
            Bestätigt am {dateTime.format(product.taxConfirmedAt)}
            {product.taxConfirmedBy ? ` von ${product.taxConfirmedBy}` : product.taxSource ? ` (Quelle: ${product.taxSource})` : ""}.
          </p>
        ) : (
          <p className="status-error">Noch nicht bestätigt. Ohne Bestätigung lässt sich das Produkt nicht freischalten.</p>
        )}
        <dl className="facts">
          <dt>Umsatzsteuer</dt>
          <dd>{TAX_LABEL[product.taxCategory]}</dd>
          {product.options.map((o) => (
            <div key={o.id} className="facts-row">
              <dt>{o.label}</dt>
              <dd>
                Preise {BASIS_LABEL[o.amountBasis]}
                <br />
                <span className="note">Käufer in Deutschland: {exampleDe(o, product.taxCategory)}</span>
              </dd>
            </div>
          ))}
        </dl>
        {edit && !product.taxConfirmedAt && (
          <ActionForm action={confirmTaxAction} submit="Steuer bestätigen">
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="tax_category" value={product.taxCategory} />
            {product.options.map((o) => (
              <input key={o.id} type="hidden" name={`basis_${o.id}`} value={o.amountBasis} />
            ))}
            <div className="field check">
              <input id="confirm" name="confirm" type="checkbox" required />
              <label htmlFor="confirm">
                Ich habe Umsatzsteuer-Art und brutto/netto je Preisoption geprüft. Sie sind so richtig (wie in Thrivecart bzw. mit der Steuerberatung abgestimmt).
              </label>
            </div>
          </ActionForm>
        )}
      </section>

      <section className="card">
        <h2>Verkauf</h2>
        {edit && (
          <ActionForm
            action={setProductActiveAction}
            submit={product.active ? "Produkt abschalten" : "Produkt freischalten"}
            confirm={product.active ? "Produkt abschalten? Kauflinks zeigen danach „nicht verfügbar“." : undefined}
          >
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="active" value={product.active ? "0" : "1"} />
          </ActionForm>
        )}
        {product.active && activeOptions.length > 0 && product.slug ? (
          <>
            <h3>Kauflinks</h3>
            <p className="note">
              {user.salesCode
                ? `Diese Links ordnen Verkäufe dir zu (Kürzel „${user.salesCode}“). Jede Vertriebsperson findet ihre eigenen Links unter „Kauflinks“.`
                : "Links ohne Vertriebskürzel. Jede Vertriebsperson findet ihre eigenen Links unter „Kauflinks“."}
            </p>
            <table className="admin-table">
              <tbody>
                {activeOptions.map((o) => (
                  <tr key={o.id}>
                    <td>{o.label}</td>
                    <td className="mono break">{`${base}/kaufen/${product.slug}/${o.id}${v}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="note">Kauflinks erscheinen hier, sobald das Produkt freigeschaltet ist.</p>
        )}
      </section>
    </>
  );
}
