import { getImage } from "@idf/db/checkout-pages";
import { pool } from "../../../lib/db";

/** Bilder der Kaufseiten. Sie ändern sich nie, daher dürfen Browser sie dauerhaft behalten. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const img = await getImage(pool(), id);
  if (!img) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${img.sha256}"`,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
