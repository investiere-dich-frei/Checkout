/**
 * Aufbau einer Kaufseite und seine Prüfung. Ohne Node- und Datenbankabhängigkeiten,
 * damit der Editor im Browser dieselben Regeln benutzt wie der Server.
 */

/**
 * Bereiche einer Kaufseite: „mitte“ = eigener Abschnitt zwischen Kopfbereich und Bestellung
 * (über die ganze Breite, z. B. Bild links und Aufzählung rechts), „inhalt“ = links neben dem
 * Formular, „formular“ = in der Bestellbox über dem Formular, „unten“ = unter der Bestellung.
 */
export type BlockArea = "mitte" | "inhalt" | "formular" | "unten";
export const BLOCK_AREAS: readonly BlockArea[] = ["mitte", "inhalt", "formular", "unten"];

export type Block =
  | { type: "ueberschrift"; area: BlockArea; text: string }
  | { type: "text"; area: BlockArea; text: string }
  | { type: "liste"; area: BlockArea; title: string; items: string[] }
  | { type: "bild"; area: BlockArea; imageId: string; alt: string }
  | { type: "zitat"; area: BlockArea; text: string; name: string; imageId: string | null }
  | { type: "person"; area: BlockArea; title: string; text: string; imageId: string | null }
  | { type: "vertrauen"; area: BlockArea; items: string[] };

export type BlockType = Block["type"];
export const BLOCK_TYPES: readonly BlockType[] = ["ueberschrift", "text", "liste", "bild", "zitat", "person", "vertrauen"];

export interface PageContent {
  /** Große Überschrift im Kopfbereich; leer = Produktname. */
  headline: string;
  subheadline: string;
  logoImageId: string | null;
  heroImageId: string | null;
  /** Knopf im Kopfbereich, springt zum Formular; leer = kein Knopf. */
  ctaText: string;
  /** Akzentfarbe für Kopfbereich, Knöpfe und Häkchen. */
  accentColor: string;
  blocks: Block[];
}

export const DEFAULT_ACCENT = "#a26766";

export const DEFAULT_CONTENT: PageContent = {
  headline: "",
  subheadline: "",
  logoImageId: null,
  heroImageId: null,
  ctaText: "Jetzt anmelden",
  accentColor: DEFAULT_ACCENT,
  blocks: [
    { type: "ueberschrift", area: "formular", text: "Deine Anmeldung" },
    { type: "text", area: "formular", text: "Deine Zugangsdaten bekommst du direkt nach dem Kauf per E-Mail." },
    { type: "vertrauen", area: "formular", items: ["Sichere, verschlüsselte Zahlung", "Deine Daten sind geschützt"] },
  ],
};

export const LIMITS = { shortText: 200, longText: 5000, items: 30, blocks: 60 } as const;

export class PageContentError extends Error {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;

function str(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new PageContentError(`${field}: Text erwartet`);
  // Steuerzeichen außer Zeilenumbruch entfernen, Zeilenenden vereinheitlichen.
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (s.length > max) throw new PageContentError(`${field}: höchstens ${max} Zeichen`);
  return s;
}

function imageId(v: unknown, field: string, required: boolean): string | null {
  if ((v === undefined || v === null || v === "") && !required) return null;
  if (typeof v !== "string" || !UUID.test(v)) throw new PageContentError(`${field}: Bild fehlt`);
  return v.toLowerCase();
}

function items(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new PageContentError(`${field}: Liste erwartet`);
  const list = v.map((x, i) => str(x, `${field} ${i + 1}`, LIMITS.shortText * 2)).filter((x) => x !== "");
  if (list.length > LIMITS.items) throw new PageContentError(`${field}: höchstens ${LIMITS.items} Punkte`);
  return list;
}

function parseBlock(raw: unknown, n: number): Block {
  if (!raw || typeof raw !== "object") throw new PageContentError(`Baustein ${n}: ungültig`);
  const b = raw as Record<string, unknown>;
  const area = BLOCK_AREAS.includes(b.area as BlockArea) ? (b.area as BlockArea) : null;
  if (!area) throw new PageContentError(`Baustein ${n}: Bereich fehlt`);
  const f = `Baustein ${n}`;
  switch (b.type) {
    case "ueberschrift":
      return { type: "ueberschrift", area, text: str(b.text, f, LIMITS.shortText) };
    case "text":
      return { type: "text", area, text: str(b.text, f, LIMITS.longText) };
    case "liste":
      return { type: "liste", area, title: str(b.title, f, LIMITS.shortText), items: items(b.items, f) };
    case "bild":
      return { type: "bild", area, imageId: imageId(b.imageId, f, true)!, alt: str(b.alt, f, LIMITS.shortText) };
    case "zitat":
      return { type: "zitat", area, text: str(b.text, f, LIMITS.longText), name: str(b.name, f, LIMITS.shortText), imageId: imageId(b.imageId, f, false) };
    case "person":
      return { type: "person", area, title: str(b.title, f, LIMITS.shortText), text: str(b.text, f, LIMITS.longText), imageId: imageId(b.imageId, f, false) };
    case "vertrauen":
      return { type: "vertrauen", area, items: items(b.items, f) };
    default:
      throw new PageContentError(`${f}: unbekannte Art`);
  }
}

/** Prüft den Inhalt einer Seite und bringt ihn in die gespeicherte Form. */
export function parsePageContent(raw: unknown): PageContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PageContentError("Seite: ungültig");
  const r = raw as Record<string, unknown>;
  const accent = r.accentColor === undefined || r.accentColor === "" ? DEFAULT_ACCENT : r.accentColor;
  if (typeof accent !== "string" || !COLOR.test(accent)) throw new PageContentError("Farbe: bitte als #rrggbb angeben");
  if (!Array.isArray(r.blocks)) throw new PageContentError("Bausteine fehlen");
  if (r.blocks.length > LIMITS.blocks) throw new PageContentError(`Höchstens ${LIMITS.blocks} Bausteine`);
  return {
    headline: str(r.headline, "Überschrift", LIMITS.shortText),
    subheadline: str(r.subheadline, "Unterzeile", LIMITS.longText),
    logoImageId: imageId(r.logoImageId, "Logo", false),
    heroImageId: imageId(r.heroImageId, "Titelbild", false),
    ctaText: str(r.ctaText, "Knopf", 60),
    accentColor: accent.toLowerCase(),
    blocks: r.blocks.map((b, i) => parseBlock(b, i + 1)),
  };
}

/** Alle Bilder, die eine Seite verwendet. */
export function imageIdsOf(c: PageContent): string[] {
  const ids = [c.logoImageId, c.heroImageId, ...c.blocks.map((b) => ("imageId" in b ? b.imageId : null))];
  return [...new Set(ids.filter((x): x is string => x !== null))];
}
