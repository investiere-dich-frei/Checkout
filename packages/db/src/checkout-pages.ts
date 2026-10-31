import { createHash } from "node:crypto";
import type pg from "pg";
import { DEFAULT_CONTENT, PageContentError, UUID, imageIdsOf, parsePageContent, type PageContent } from "./checkout-page-content.ts";
export * from "./checkout-page-content.ts";

/**
 * Gestaltung der Kaufseiten (Editor in der Verwaltung, Anzeige unter /kaufen).
 *
 * Eine Seite hat einen Kopfbereich und eine Liste von Bausteinen. Jeder Baustein steht
 * in einem Bereich: „inhalt“ (links neben dem Bestellformular), „formular“ (rechts über
 * dem Formular) oder „unten“ (über die ganze Breite unter beidem).
 *
 * Preise, der Bestellknopf und die Rechtstexte sind nicht Teil der Gestaltung.
 */

type Db = pg.Pool | pg.ClientBase;

export interface StoredPage {
  content: PageContent;
  updatedAt: Date;
}

async function loadRow(db: Db, productId: string | null): Promise<StoredPage | null> {
  const { rows } = await db.query(
    productId === null
      ? `select content, updated_at from app.checkout_pages where product_id is null`
      : `select content, updated_at from app.checkout_pages where product_id = $1`,
    productId === null ? [] : [productId],
  );
  if (!rows[0]) return null;
  return { content: parsePageContent(rows[0].content), updatedAt: rows[0].updated_at };
}

/** Gespeicherte Seite eines Produkts (null = Standardseite), ohne Rückfall. */
export async function getStoredPage(db: Db, productId: string | null): Promise<StoredPage | null> {
  return loadRow(db, productId);
}

/**
 * Die Seite, wie der Checkout sie zeigt: eigene Seite des Produkts, sonst die
 * Standardseite, sonst die eingebaute Vorgabe. Logo und Farbe ohne eigenen Wert
 * kommen von der Standardseite.
 */
export async function resolvePage(db: Db, productId: string): Promise<PageContent> {
  const [own, standard] = await Promise.all([loadRow(db, productId), loadRow(db, null)]);
  const base = standard?.content ?? DEFAULT_CONTENT;
  if (!own) return base;
  return { ...own.content, logoImageId: own.content.logoImageId ?? base.logoImageId };
}

/** Speichert eine Seite. Alle verwendeten Bilder müssen vorhanden sein. */
export async function savePage(client: pg.ClientBase, productId: string | null, raw: unknown, userId: string | null): Promise<PageContent> {
  const content = parsePageContent(raw);
  const ids = imageIdsOf(content);
  if (ids.length) {
    const { rows } = await client.query(`select id from app.checkout_images where id = any($1::uuid[])`, [ids]);
    if (rows.length !== ids.length) throw new PageContentError("Ein Bild fehlt; bitte neu hochladen");
  }
  if (productId !== null) {
    const { rowCount } = await client.query(`select 1 from app.products where id = $1`, [productId]);
    if (!rowCount) throw new PageContentError("Produkt nicht gefunden");
  }
  const json = JSON.stringify(content);
  const updated = await client.query(
    productId === null
      ? `update app.checkout_pages set content = $1, updated_at = now(), updated_by = $2 where product_id is null`
      : `update app.checkout_pages set content = $1, updated_at = now(), updated_by = $2 where product_id = $3`,
    productId === null ? [json, userId] : [json, userId, productId],
  );
  if (!updated.rowCount) {
    await client.query(`insert into app.checkout_pages (product_id, content, updated_by) values ($1, $2, $3)`, [productId, json, userId]);
  }
  return content;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Erkennt das Bildformat am Dateianfang; dem angegebenen Typ wird nicht vertraut. */
export function sniffImageType(data: Uint8Array): string | null {
  const starts = (...b: number[]) => b.every((x, i) => data[i] === x);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  return null;
}

/** Legt ein Bild ab; dieselbe Datei ein zweites Mal liefert die vorhandene ID. */
export async function saveImage(client: pg.ClientBase, data: Uint8Array, originalName: string, userId: string | null): Promise<string> {
  if (data.length === 0) throw new PageContentError("Die Datei ist leer");
  if (data.length > MAX_IMAGE_BYTES) throw new PageContentError("Das Bild ist größer als 3 MB");
  const mime = sniffImageType(data);
  if (!mime) throw new PageContentError("Bitte ein Bild als PNG, JPG, WebP oder GIF hochladen");
  const sha = createHash("sha256").update(data).digest();
  const name = originalName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "bild";
  const { rows } = await client.query(
    `insert into app.checkout_images (sha256, mime_type, data, original_name, created_by)
     values ($1, $2, $3, $4, $5)
     on conflict (sha256) do nothing
     returning id`,
    [sha, mime, Buffer.from(data), name, userId],
  );
  if (rows[0]) return rows[0].id;
  const existing = await client.query(`select id from app.checkout_images where sha256 = $1`, [sha]);
  return existing.rows[0].id;
}

export async function getImage(db: Db, id: string): Promise<{ mimeType: string; data: Buffer; sha256: string } | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await db.query(`select mime_type, data, encode(sha256, 'hex') sha from app.checkout_images where id = $1`, [id]);
  return rows[0] ? { mimeType: rows[0].mime_type, data: rows[0].data, sha256: rows[0].sha } : null;
}

export interface ImageRow {
  id: string;
  name: string;
  createdAt: Date;
}

/** Zuletzt hochgeladene Bilder, für die Auswahl im Editor. */
export async function listImages(db: Db, limit = 60): Promise<ImageRow[]> {
  const { rows } = await db.query(
    `select id, original_name, created_at from app.checkout_images order by created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, name: r.original_name, createdAt: r.created_at }));
}

export interface PageOverviewRow {
  productId: string;
  name: string;
  slug: string | null;
  active: boolean;
  hasOwnPage: boolean;
  updatedAt: Date | null;
}

/** Produkte mit Angabe, ob sie eine eigene Seite haben; freigeschaltete zuerst. */
export async function listPageOverview(db: Db): Promise<PageOverviewRow[]> {
  const { rows } = await db.query(
    `select p.id, p.name, p.slug, p.active, cp.updated_at
       from app.products p
       left join app.checkout_pages cp on cp.product_id = p.id
      order by p.active desc, p.name`,
  );
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    slug: r.slug,
    active: r.active,
    hasOwnPage: r.updated_at !== null,
    updatedAt: r.updated_at,
  }));
}

/** Freigeschaltete Preisoptionen eines Produkts, für Links zur echten Kaufseite. */
export async function productOffers(db: Db, productId: string): Promise<{ name: string; slug: string | null; options: { id: string; label: string }[] } | null> {
  const p = await db.query(`select name, slug from app.products where id = $1`, [productId]);
  if (!p.rows[0]) return null;
  const o = await db.query(`select id, label from app.price_options where product_id = $1 and active order by label`, [productId]);
  return { name: p.rows[0].name, slug: p.rows[0].slug, options: o.rows.map((r) => ({ id: r.id, label: r.label })) };
}
