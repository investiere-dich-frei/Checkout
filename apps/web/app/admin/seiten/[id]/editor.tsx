"use client";

import {
  LIMITS,
  PageContentError,
  parsePageContent,
  type Block,
  type BlockArea,
  type BlockType,
  type PageContent,
} from "@idf/db/checkout-page-content";
import { useActionState, useId, useState } from "react";
import { CheckoutPageView, imageUrl } from "../../../../lib/checkout-page-view";
import { savePageAction, type SaveState } from "../actions";

interface ImageOption {
  id: string;
  name: string;
}

const TYPE_LABEL: Record<BlockType, string> = {
  ueberschrift: "Überschrift",
  text: "Text",
  liste: "Aufzählung",
  bild: "Bild",
  zitat: "Zitat / Kundenstimme",
  person: "Person mit Bild (z. B. über Emilia)",
  vertrauen: "Vertrauenshinweise mit Häkchen",
};

const AREA_LABEL: Record<BlockArea, string> = {
  inhalt: "Links neben dem Formular",
  formular: "Rechts über dem Formular",
  unten: "Unten, ganze Breite",
};

function newBlock(type: BlockType): Block {
  const area: BlockArea = "inhalt";
  switch (type) {
    case "ueberschrift":
      return { type, area, text: "" };
    case "text":
      return { type, area, text: "" };
    case "liste":
      return { type, area, title: "", items: [""] };
    case "bild":
      return { type, area, imageId: "", alt: "" };
    case "zitat":
      return { type, area: "unten", text: "", name: "", imageId: null };
    case "person":
      return { type, area: "unten", title: "", text: "", imageId: null };
    case "vertrauen":
      return { type, area: "formular", items: ["Sichere, verschlüsselte Zahlung"] };
  }
}

function ImagePicker(props: {
  label: string;
  value: string | null;
  images: ImageOption[];
  onChange: (id: string | null) => void;
  onUploaded: (img: ImageOption) => void;
  optional?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/admin/seiten/bild", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "Hochladen fehlgeschlagen");
      props.onUploaded({ id: json.id, name: json.name ?? file.name });
      props.onChange(json.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-field">
      <label htmlFor={id}>{props.label}</label>
      <div className="ed-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {props.value && <img src={imageUrl(props.value)} alt="" />}
        <div>
          <select id={id} value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value || null)}>
            <option value="">{props.optional === false ? "Bild wählen …" : "kein Bild"}</option>
            {props.images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <label className="ed-upload">
            {busy ? "Wird hochgeladen …" : "Neues Bild hochladen"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function TextInput(props: { label: string; value: string; onChange: (v: string) => void; long?: boolean; hint?: string; max?: number }) {
  const id = useId();
  return (
    <div className="ed-field">
      <label htmlFor={id}>{props.label}</label>
      {props.long ? (
        <textarea id={id} rows={5} value={props.value} maxLength={props.max ?? LIMITS.longText} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" value={props.value} maxLength={props.max ?? LIMITS.shortText} onChange={(e) => props.onChange(e.target.value)} />
      )}
      {props.hint && <p className="note">{props.hint}</p>}
    </div>
  );
}

function ItemsInput(props: { label: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <TextInput
      label={props.label}
      long
      value={props.items.join("\n")}
      onChange={(v) => props.onChange(v.split("\n"))}
      hint="Ein Punkt pro Zeile. **so** wird fett."
    />
  );
}

function BlockFields(props: { block: Block; images: ImageOption[]; onChange: (b: Block) => void; onUploaded: (i: ImageOption) => void }) {
  const b = props.block;
  const set = (patch: Partial<Block>) => props.onChange({ ...b, ...patch } as Block);
  switch (b.type) {
    case "ueberschrift":
      return <TextInput label="Überschrift" value={b.text} onChange={(text) => set({ text })} />;
    case "text":
      return <TextInput label="Text" long value={b.text} onChange={(text) => set({ text })} hint="Leerzeile = neuer Absatz. **so** wird fett." />;
    case "liste":
      return (
        <>
          <TextInput label="Titel (optional)" value={b.title} onChange={(title) => set({ title })} />
          <ItemsInput label="Punkte" items={b.items} onChange={(items) => set({ items })} />
        </>
      );
    case "bild":
      return (
        <>
          <ImagePicker label="Bild" optional={false} value={b.imageId || null} images={props.images} onChange={(imageId) => set({ imageId: imageId ?? "" })} onUploaded={props.onUploaded} />
          <TextInput label="Bildbeschreibung für Screenreader (optional)" value={b.alt} onChange={(alt) => set({ alt })} />
        </>
      );
    case "zitat":
      return (
        <>
          <TextInput label="Zitat" long value={b.text} onChange={(text) => set({ text })} />
          <TextInput label="Name" value={b.name} onChange={(name) => set({ name })} hint="Nur mit Einverständnis der Person." />
          <ImagePicker label="Foto (optional)" value={b.imageId} images={props.images} onChange={(imageId) => set({ imageId })} onUploaded={props.onUploaded} />
        </>
      );
    case "person":
      return (
        <>
          <TextInput label="Titel" value={b.title} onChange={(title) => set({ title })} />
          <TextInput label="Text" long value={b.text} onChange={(text) => set({ text })} hint="Leerzeile = neuer Absatz. **so** wird fett." />
          <ImagePicker label="Foto (optional)" value={b.imageId} images={props.images} onChange={(imageId) => set({ imageId })} onUploaded={props.onUploaded} />
        </>
      );
    case "vertrauen":
      return <ItemsInput label="Hinweise" items={b.items} onChange={(items) => set({ items })} />;
  }
}

function FormPlaceholder() {
  return (
    <div className="ed-form-placeholder" aria-hidden="true">
      <div className="card">
        <strong>Deine Angaben</strong>
        <p className="note">Name, E-Mail, Adresse, Land …</p>
      </div>
      <div className="card">
        <strong>Deine Bestellung</strong>
        <p className="note">Preis, Raten und Steuer kommen automatisch aus dem Produkt.</p>
      </div>
      <div className="card">
        <strong>Zustimmung</strong>
        <p className="note">AGB, Datenschutz, Widerruf (automatisch)</p>
      </div>
      <button type="button" className="order" disabled>
        Zahlungspflichtig bestellen
      </button>
    </div>
  );
}

export function PageEditor(props: { target: string; productName: string; optionLabel: string; initial: PageContent; images: ImageOption[] }) {
  const [content, setContent] = useState<PageContent>(props.initial);
  const [images, setImages] = useState<ImageOption[]>(props.images);
  const [addType, setAddType] = useState<BlockType>("text");
  const [state, action, pending] = useActionState<SaveState, FormData>(savePageAction, { ok: false, message: null });
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<PageContent>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const setBlocks = (fn: (blocks: Block[]) => Block[]) => update({ blocks: fn(content.blocks) });
  const uploaded = (img: ImageOption) => setImages((list) => (list.some((i) => i.id === img.id) ? list : [img, ...list]));

  // Gleiche Prüfung wie auf dem Server, damit Fehler vor dem Speichern sichtbar sind.
  let problem: string | null = null;
  try {
    parsePageContent(content);
  } catch (e) {
    problem = e instanceof PageContentError ? e.message : "Ungültige Eingabe";
  }
  // Für die Vorschau: unfertige Bausteine (Bild ohne Datei) auslassen.
  const preview: PageContent = { ...content, blocks: content.blocks.filter((b) => b.type !== "bild" || b.imageId !== "") };

  const move = (i: number, d: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const copy = [...bs];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });

  return (
    <div className="page-editor">
      <form
        className="card ed-controls"
        action={(fd) => {
          setDirty(false);
          return action(fd);
        }}
      >
        <input type="hidden" name="target" value={props.target} />
        <input type="hidden" name="content" value={JSON.stringify(content)} />

        <h2>Kopfbereich</h2>
        <ImagePicker label="Logo" value={content.logoImageId} images={images} onChange={(logoImageId) => update({ logoImageId })} onUploaded={uploaded} />
        {props.target !== "standard" && <p className="note">Ohne eigenes Logo erscheint das Logo der Standardseite.</p>}
        <TextInput label="Große Überschrift" value={content.headline} onChange={(headline) => update({ headline })} hint="Leer = Produktname." />
        <TextInput label="Unterzeile" long value={content.subheadline} onChange={(subheadline) => update({ subheadline })} />
        <ImagePicker label="Titelbild (rechts neben der Überschrift)" value={content.heroImageId} images={images} onChange={(heroImageId) => update({ heroImageId })} onUploaded={uploaded} />
        <TextInput label="Knopf im Kopfbereich" value={content.ctaText} max={60} onChange={(ctaText) => update({ ctaText })} hint="Springt zum Bestellformular. Leer = kein Knopf." />
        <div className="ed-field">
          <label htmlFor="accent">Akzentfarbe</label>
          <div className="ed-color">
            <input id="accent" type="color" value={content.accentColor} onChange={(e) => update({ accentColor: e.target.value })} />
            <span className="mono">{content.accentColor}</span>
            <button type="button" className="link-button" onClick={() => update({ accentColor: "#a26766" })}>
              IDF-Rosé
            </button>
          </div>
        </div>

        <h2>Bausteine</h2>
        <p className="note">Der Bestellknopf heißt immer „Zahlungspflichtig bestellen“; Preise und Rechtstexte kommen automatisch.</p>
        {content.blocks.length === 0 && <p className="note">Noch keine Bausteine.</p>}
        {content.blocks.map((b, i) => (
          <fieldset key={i} className="ed-block">
            <legend>
              {i + 1}. {TYPE_LABEL[b.type]}
            </legend>
            <div className="ed-block-tools">
              <select aria-label="Bereich" value={b.area} onChange={(e) => setBlocks((bs) => bs.map((x, k) => (k === i ? ({ ...x, area: e.target.value as BlockArea } as Block) : x)))}>
                {(Object.keys(AREA_LABEL) as BlockArea[]).map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABEL[a]}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="nach oben">
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === content.blocks.length - 1} aria-label="nach unten">
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Baustein „${TYPE_LABEL[b.type]}“ entfernen?`)) setBlocks((bs) => bs.filter((_, k) => k !== i));
                }}
              >
                Entfernen
              </button>
            </div>
            <BlockFields block={b} images={images} onUploaded={uploaded} onChange={(nb) => setBlocks((bs) => bs.map((x, k) => (k === i ? nb : x)))} />
          </fieldset>
        ))}
        <div className="ed-add">
          <select aria-label="Art des neuen Bausteins" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
            {(Object.keys(TYPE_LABEL) as BlockType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setBlocks((bs) => [...bs, newBlock(addType)])}>
            Baustein hinzufügen
          </button>
        </div>

        <div className="ed-save">
          {problem && <p className="error">{problem}</p>}
          {state.message && !dirty && (
            <p className={state.ok ? "note" : "error"} role="status">
              {state.message}
            </p>
          )}
          {dirty && <p className="note">Nicht gespeicherte Änderungen.</p>}
          <button type="submit" className="order" disabled={pending || problem !== null}>
            {pending ? "Wird gespeichert …" : "Speichern"}
          </button>
        </div>
      </form>

      <section className="ed-preview" aria-label="Vorschau">
        <p className="note">Vorschau (verkleinert)</p>
        <div className="ed-preview-frame">
          <CheckoutPageView content={preview} productName={props.productName} optionLabel={props.optionLabel} form={<FormPlaceholder />} />
        </div>
      </section>
    </div>
  );
}
