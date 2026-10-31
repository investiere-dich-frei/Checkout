"use client";

import { useState } from "react";
import type { CouponValues } from "../../../lib/coupon-form";

/**
 * Felder eines Gutscheins. Ist der Gutschein schon eingelöst (locked), bleiben Code,
 * Rabatt und Geltung fest; sie werden dann nur angezeigt und unverändert mitgeschickt.
 */
export function CouponFields(props: { values: CouponValues; products: { id: string; name: string; active: boolean }[]; locked: boolean }) {
  const v = props.values;
  const [kind, setKind] = useState(v.kind);
  const [all, setAll] = useState(v.allProducts);
  const [filter, setFilter] = useState("");
  const chosen = new Set(v.productIds);
  // Ausgefilterte Produkte nur verstecken, damit ihr Häkchen erhalten bleibt.
  const matches = (name: string) => !filter || name.toLowerCase().includes(filter.toLowerCase());
  const ro = props.locked;

  return (
    <>
      {ro && (
        <p className="note">
          Dieser Gutschein wurde schon eingelöst. Code, Rabatt und „gilt für“ bleiben deshalb fest (GoBD). Zeitraum, Limit, Produkte und Bezeichnung lassen sich weiter ändern.
        </p>
      )}
      <div className="field">
        <label htmlFor="code">Gutscheincode (den gibt die Kundin ein)</label>
        <input id="code" name="code" type="text" required maxLength={40} defaultValue={v.code} readOnly={ro} style={{ textTransform: "uppercase" }} placeholder="z. B. HERBST20" />
      </div>
      <div className="field">
        <label htmlFor="label">Interne Bezeichnung (optional, sieht nur die Verwaltung)</label>
        <input id="label" name="label" type="text" maxLength={200} defaultValue={v.label} placeholder="z. B. Aktion Webinar Oktober" />
      </div>

      <fieldset className="field">
        <legend>Rabatt</legend>
        {ro && <input type="hidden" name="kind" value={kind} />}
        <div className="radio-row">
          <label>
            <input type="radio" name={ro ? undefined : "kind"} value="prozent" checked={kind === "prozent"} disabled={ro} onChange={() => setKind("prozent")} /> Prozent
          </label>
          <label>
            <input type="radio" name={ro ? undefined : "kind"} value="betrag" checked={kind === "betrag"} disabled={ro} onChange={() => setKind("betrag")} /> Fester Betrag
          </label>
        </div>
        {kind === "prozent" ? (
          <div className="field">
            <label htmlFor="percent">Prozent (z. B. 10 oder 12,5)</label>
            <input id="percent" name="percent" type="text" inputMode="decimal" required defaultValue={v.percent} readOnly={ro} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="amount">Betrag in Euro (wird vom Preis abgezogen, so wie er im Produkt steht: brutto oder netto)</label>
            <input id="amount" name="amount" type="text" inputMode="decimal" required defaultValue={v.amount} readOnly={ro} />
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Gilt bei Raten und Abos für</legend>
        {ro && <input type="hidden" name="scope" value={v.scope} />}
        <div className="radio-row">
          <label>
            <input type="radio" name={ro ? undefined : "scope"} value="erste" defaultChecked={v.scope === "erste"} disabled={ro} /> nur die erste Zahlung
          </label>
          <label>
            <input type="radio" name={ro ? undefined : "scope"} value="alle" defaultChecked={v.scope === "alle"} disabled={ro} /> jede Zahlung
          </label>
        </div>
        <p className="note">Bei Einmalzahlungen ist beides gleich.</p>
      </fieldset>

      <fieldset className="field">
        <legend>Produkte</legend>
        <label className="check">
          <input type="checkbox" name="all_products" checked={all} onChange={(e) => setAll(e.target.checked)} /> <span>Alle Produkte</span>
        </label>
        {!all && (
          <>
            <input type="search" aria-label="Produkte filtern" placeholder="Produkt suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="coupon-products">
              {props.products.map((p) => (
                <label key={p.id} className="check" hidden={!matches(p.name)}>
                  <input type="checkbox" name="product_ids" value={p.id} defaultChecked={chosen.has(p.id)} />
                  <span>
                    {p.name}
                    {!p.active && <span className="note"> (abgeschaltet)</span>}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <div className="coupon-grid">
        <div className="field">
          <label htmlFor="valid_from">Gültig ab (optional)</label>
          <input id="valid_from" name="valid_from" type="date" defaultValue={v.validFrom} />
        </div>
        <div className="field">
          <label htmlFor="valid_until">Gültig bis einschließlich (optional)</label>
          <input id="valid_until" name="valid_until" type="date" defaultValue={v.validUntil} />
        </div>
        <div className="field">
          <label htmlFor="max_redemptions">Höchstens so oft einlösbar (leer = unbegrenzt)</label>
          <input id="max_redemptions" name="max_redemptions" type="number" min={1} step={1} defaultValue={v.maxRedemptions} />
        </div>
      </div>
    </>
  );
}
