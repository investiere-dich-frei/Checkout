import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";
import type pg from "pg";
import { DEFAULT_CONTENT, type Block, type BlockArea } from "./checkout-page-content.ts";
import { getStoredPage, saveImage, savePage } from "./checkout-pages.ts";

/**
 * Liest gespeicherte öffentliche Thrivecart-Kaufseiten (HTML) und macht daraus einen
 * Entwurf für den Editor: Kopfbereich und Bausteine. Bilder werden über ihren
 * Dateinamen in der Thrivecart-Adresse bezeichnet; der Aufrufer ersetzt sie durch
 * die IDs der gespeicherten Bilder.
 *
 * Übernommen wird nur Gestaltung. Formular, Preise, Gutscheinfeld, Knöpfe und
 * Rechtstexte aus Thrivecart werden bewusst ausgelassen: Die kommen im neuen
 * Checkout aus dem System.
 */

/** Ein Baustein, der ein Bild über seinen Thrivecart-Dateinamen bezeichnet. */
export type DraftBlock = Block;

export interface ThrivecartDraft {
  headline: string;
  subheadline: string;
  ctaText: string;
  logoImage: string | null;
  heroImage: string | null;
  /** Bild-Felder enthalten hier den Dateinamen (siehe imageKey), nicht die ID. */
  blocks: DraftBlock[];
  /** Alle verwendeten Bild-Dateinamen. */
  images: string[];
  template: "v2" | "alt";
}

/** Dateiname eines IDF-Uploads aus einer Thrivecart-Bildadresse, sonst null. */
export function imageKey(src: string | undefined): string | null {
  if (!src || !src.includes("user_assets%2FLGUM1CR8")) return null;
  const i = src.lastIndexOf("images%2F");
  if (i < 0) return null;
  const raw = src.slice(i + "images%2F".length).split(/[?#]/)[0]!;
  try {
    const name = decodeURIComponent(raw);
    return /^[\w.-]+$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Seite gibt es nicht mehr (Thrivecart zeigt dann eine leere Seite mit Titel „ThriveCart“). */
export function isMissingPage(html: string): boolean {
  return !html.includes("builder-v2-widget");
}

const HIDDEN = ["hidden", "display-none"];
const isHidden = (el: HTMLElement) => HIDDEN.some((c) => el.classList.contains(c));
const el = (n: Node): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE;
const BLOCK_TAGS = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6"]);

function emoji(src: string): string {
  const m = /\/emoji\/[^/]+\/([0-9a-f-]+)\.png/i.exec(src);
  if (!m) return "";
  try {
    return String.fromCodePoint(...m[1]!.split("-").map((h) => parseInt(h, 16)));
  } catch {
    return "";
  }
}

/** HTML eines Textbausteins als Text: Zeilen, Absätze (Leerzeile) und **fett**. */
export function htmlToText(node: HTMLElement): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === NodeType.TEXT_NODE) {
      out.push(n.text.replace(/\s+/g, " "));
      return;
    }
    if (!el(n) || isHidden(n)) return;
    const tag = n.rawTagName?.toLowerCase();
    if (tag === "br") return void out.push("\n");
    if (tag === "img") return void out.push(emoji(n.getAttribute("src") ?? ""));
    if (tag === "script" || tag === "style") return;
    if (tag === "b" || tag === "strong") {
      const inner = htmlToText(n).replace(/\n+/g, " ");
      const t = inner.trim();
      if (t) out.push(`${inner.startsWith(" ") ? " " : ""}**${t}**${inner.endsWith(" ") ? " " : ""}`);
      return;
    }
    const block = tag !== undefined && BLOCK_TAGS.has(tag);
    if (block) out.push("\n");
    n.childNodes.forEach(walk);
    if (block) out.push(tag === "p" ? `\n${PARAGRAPH}\n` : "\n");
  };
  node.childNodes.forEach(walk);
  return normalize(out.join(""));
}

const PARAGRAPH = "\u0001";

function normalize(s: string): string {
  const lines = s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim());
  const kept: string[] = [];
  let blank = 0;
  for (const l of lines) {
    if (l === "" || l === PARAGRAPH) {
      blank += l === PARAGRAPH ? 2 : 1;
      continue;
    }
    // Absatzende (</p>) oder eine leere Zeile zwischen zwei Blöcken (<div><br></div>) beginnt einen neuen Absatz.
    if (kept.length && blank >= 2) kept.push("");
    kept.push(l.replace(/\*\*\*\*/g, ""));
    blank = 0;
  }
  return kept.join("\n").trim();
}

const plain = (s: string) => s.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").trim();

function widgetType(w: HTMLElement): string | null {
  for (const c of w.classList.values()) {
    const m = /^tc-v2-widget-(.+)$/.exec(c);
    if (m) return m[1]!;
  }
  return null;
}

/** Inhalt eines Text-Widgets ohne Hintergrund-Hüllen. */
function textNode(w: HTMLElement): HTMLElement | null {
  return w.querySelector(".builder-v2-block-text") ?? w.querySelector(".builder-v2-block-heading") ?? w.querySelector(".builder-v2-block");
}

function textBlocks(text: string, area: BlockArea): Block[] {
  if (!text) return [];
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  // Zeilen, die alle mit einem Häkchen beginnen, werden Vertrauenshinweise.
  if (lines.length > 0 && lines.every((l) => /^\s*(\*\*)?\s*✅/.test(l))) {
    return [{ type: "vertrauen", area, items: lines.map((l) => plain(l.replace("✅", "")).replace(/\.$/, "")) }];
  }
  return [{ type: "text", area, text }];
}

/** Bausteine eines Bereichs der Seite, in Reihenfolge. */
function collect(container: HTMLElement, area: BlockArea, skip: (n: HTMLElement) => boolean): Block[] {
  const blocks: Block[] = [];
  const walk = (n: HTMLElement) => {
    if (isHidden(n) || skip(n)) return;
    if (!n.classList.contains("builder-v2-widget")) {
      n.childNodes.filter(el).forEach(walk);
      return;
    }
    const type = widgetType(n);
    switch (type) {
      case "heading":
      case "subheading": {
        const t = plain(htmlToText(textNode(n) ?? n));
        if (t) blocks.push({ type: "ueberschrift", area, text: t });
        break;
      }
      case "text":
        blocks.push(...textBlocks(htmlToText(textNode(n) ?? n), area));
        break;
      case "bullets": {
        const col = n.querySelectorAll(".builder-v2-block-bullets").find((b) => !b.closest(".display-none") && !isHidden(b));
        const items = (col?.querySelectorAll("p") ?? []).map((p) => htmlToText(p).replace(/\n+/g, " ").trim()).filter((x) => x && !/^Enter your bullet points/i.test(x));
        if (items.length) blocks.push({ type: "liste", area, title: "", items });
        break;
      }
      case "fixed_image":
      case "image": {
        const key = imageKey(n.querySelector("img")?.getAttribute("src"));
        if (key) blocks.push({ type: "bild", area, imageId: key, alt: "" });
        break;
      }
      case "column":
        blocks.push(...columnBlocks(n, area, skip));
        break;
      default:
        // Formular, Preise, Knöpfe, Gutschein, Fußzeile, HTML, Trennlinien: nicht übernehmen.
        break;
    }
  };
  walk(container);
  return blocks;
}

/** Spalten: Bild in einer Spalte, Überschrift und Text in der anderen ergibt „Person mit Bild“. */
function columnBlocks(w: HTMLElement, area: BlockArea, skip: (n: HTMLElement) => boolean): Block[] {
  const grid = w.querySelector(".builder-v2-block-column-grid");
  const cols = (grid?.childNodes.filter(el) ?? []).filter((c) => c.classList.contains("builder-v2-col") && !isHidden(c));
  const perCol = cols.map((c) => collect(c, area, skip)).filter((b) => b.length > 0);
  const imageCol = perCol.findIndex((b) => b.length === 1 && b[0]!.type === "bild");
  if (perCol.length === 2 && imageCol >= 0) {
    const other = perCol[1 - imageCol]!;
    if (other.every((b) => b.type === "ueberschrift" || b.type === "text")) {
      const heading = other.find((b) => b.type === "ueberschrift");
      const text = other.filter((b) => b !== heading).map((b) => (b.type === "text" || b.type === "ueberschrift" ? b.text : "")).join("\n\n");
      const img = perCol[imageCol]![0] as Extract<Block, { type: "bild" }>;
      return [{ type: "person", area, title: heading && heading.type === "ueberschrift" ? heading.text : "", text, imageId: img.imageId }];
    }
  }
  return perCol.flat();
}

const coreWidget = (n: HTMLElement) => {
  const t = n.classList.contains("builder-v2-widget") ? widgetType(n) : null;
  return t !== null && (t.startsWith("core_") || t === "buy_link" || t === "overlay");
};

export function parseThrivecartPage(html: string): ThrivecartDraft {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false } });
  const draft: ThrivecartDraft = { headline: "", subheadline: "", ctaText: "", logoImage: null, heroImage: null, blocks: [], images: [], template: "v2" };
  const regions = root.querySelectorAll(".builder-v2-region");
  const skipCheckout = (n: HTMLElement) => coreWidget(n) || n.classList.contains("checkout-panes") || n.classList.contains("region-footer");

  if (regions.length === 0) {
    draft.template = "alt";
    const main = root.querySelector(".thrivecart-main") ?? root.querySelector(".thrivecart-site");
    if (main) draft.blocks.push(...collect(main, "inhalt", skipCheckout));
  }

  let afterCart = false;
  for (const r of regions) {
    const cls = r.classList;
    const name = [...cls.values()].join(" ");
    if (/tc-v2-region-overlay/.test(name)) continue;
    if (/tc-v2-region-hero-/.test(name)) {
      draft.logoImage = imageKey(r.querySelector(".section-logo img")?.getAttribute("src"));
      const content = r.querySelector(".region-area-content") ?? r;
      const hero = collect(content, "inhalt", (n) => coreWidget(n) || n.classList.contains("section-logo"));
      const heading = hero.find((b) => b.type === "ueberschrift");
      if (heading && heading.type === "ueberschrift") draft.headline = heading.text;
      draft.subheadline = hero
        .filter((b) => b !== heading && (b.type === "text" || b.type === "ueberschrift"))
        .map((b) => (b.type === "text" || b.type === "ueberschrift" ? b.text : ""))
        .join("\n\n");
      const button = content.querySelector(".tc-v2-widget-buy_link button");
      if (button) draft.ctaText = plain(htmlToText(button)).slice(0, 60);
      const primary = r.querySelector(".region-area-primary");
      draft.heroImage = imageKey(primary?.querySelector("img")?.getAttribute("src"));
      if (!draft.heroImage) draft.blocks.push(...hero.filter((b) => b.type === "bild"));
      continue;
    }
    if (/region_type_cart/.test(name)) {
      afterCart = true;
      const sidebar = r.querySelector(".region-area-sidebar");
      if (sidebar) draft.blocks.push(...collect(sidebar, "inhalt", skipCheckout));
      for (const area of r.querySelectorAll(".region-area-content")) {
        draft.blocks.push(...collect(area, "formular", skipCheckout));
      }
      continue;
    }
    draft.blocks.push(...collect(r, afterCart ? "unten" : "inhalt", skipCheckout));
  }

  // Thrivecart-Platzhalter und Anleitungen an die Kundschaft für das alte Formular weglassen.
  draft.blocks = draft.blocks.filter((b) => !(b.type === "ueberschrift" && /^Trag unten deine Daten ein\.?$/i.test(b.text)));

  const imgs = [draft.logoImage, draft.heroImage, ...draft.blocks.map((b) => ("imageId" in b ? b.imageId : null))];
  draft.images = [...new Set(imgs.filter((x): x is string => !!x))];
  return draft;
}

export interface ImportRow {
  slug: string;
  status: "übernommen" | "überschrieben" | "vorhanden, ausgelassen" | "kein Produkt" | "Seite fehlt bei Thrivecart" | "Bild fehlt";
  blocks: number;
  detail?: string;
}

/**
 * Legt aus den gelesenen Thrivecart-Seiten Kaufseiten an. Bestehende eigene Seiten
 * bleiben unberührt, außer overwrite ist gesetzt. Gibt es noch keine Standardseite,
 * bekommt sie das häufigste Logo. Läuft in der Transaktion des Aufrufers.
 */
export async function importThrivecartPages(
  client: pg.ClientBase,
  pages: { slug: string; html: string }[],
  imageFiles: Map<string, Uint8Array>,
  opts: { overwrite?: boolean } = {},
): Promise<ImportRow[]> {
  await client.query(`select set_config('app.actor', 'system:thrivecart-kaufseiten', true)`);
  const rows: ImportRow[] = [];
  const ids = new Map<string, string>();
  const logos = new Map<string, number>();

  const imageId = async (key: string | null): Promise<string | null> => {
    if (!key) return null;
    if (!ids.has(key)) {
      const data = imageFiles.get(key);
      if (!data) throw new MissingImage(key);
      ids.set(key, await saveImage(client, data, key, null));
    }
    return ids.get(key)!;
  };

  for (const { slug, html } of pages) {
    if (isMissingPage(html)) {
      rows.push({ slug, status: "Seite fehlt bei Thrivecart", blocks: 0 });
      continue;
    }
    const product = (await client.query(`select id from app.products where slug = $1`, [slug])).rows[0]?.id as string | undefined;
    if (!product) {
      rows.push({ slug, status: "kein Produkt", blocks: 0 });
      continue;
    }
    const existing = await getStoredPage(client, product);
    if (existing && !opts.overwrite) {
      rows.push({ slug, status: "vorhanden, ausgelassen", blocks: existing.content.blocks.length });
      continue;
    }
    const d = parseThrivecartPage(html);
    try {
      await client.query("savepoint seite");
      const blocks: Block[] = [];
      for (const b of d.blocks) {
        if (b.type === "bild") blocks.push({ ...b, imageId: (await imageId(b.imageId))! });
        else if (b.type === "zitat" || b.type === "person") blocks.push({ ...b, imageId: await imageId(b.imageId) });
        else blocks.push(b);
      }
      if (d.logoImage) logos.set(d.logoImage, (logos.get(d.logoImage) ?? 0) + 1);
      await savePage(
        client,
        product,
        {
          headline: d.headline,
          subheadline: d.subheadline,
          ctaText: d.ctaText || DEFAULT_CONTENT.ctaText,
          logoImageId: await imageId(d.logoImage),
          heroImageId: await imageId(d.heroImage),
          accentColor: "",
          blocks,
        },
        null,
      );
      await client.query("release savepoint seite");
      rows.push({ slug, status: existing ? "überschrieben" : "übernommen", blocks: blocks.length, detail: d.template === "alt" ? "ältere Vorlage" : undefined });
    } catch (err) {
      await client.query("rollback to savepoint seite");
      if (err instanceof MissingImage) rows.push({ slug, status: "Bild fehlt", blocks: 0, detail: err.key });
      else throw err;
    }
  }

  const topLogo = [...logos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topLogo && !(await getStoredPage(client, null))) {
    await savePage(client, null, { ...DEFAULT_CONTENT, logoImageId: ids.get(topLogo) }, null);
  }
  return rows;
}

class MissingImage extends Error {
  constructor(readonly key: string) {
    super(`Bild fehlt: ${key}`);
  }
}
