import { invoicePdf } from "@idf/db/invoice-pdf";
import { pool } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rechnungs-PDF zum Herunterladen, nur zusammen mit der passenden Bestellung. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; invoice: string }> }): Promise<Response> {
  const { id, invoice } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(invoice)) return new Response("Nicht gefunden", { status: 404 });
  const owns = await pool().query(`select 1 from app.invoices where id = $1 and order_id = $2`, [invoice, id]);
  const doc = owns.rowCount ? await invoicePdf(pool(), invoice) : null;
  if (!doc) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(doc.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${doc.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
