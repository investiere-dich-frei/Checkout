import {
  AccountingError,
  buildZip,
  invoiceLines,
  invoiceLinesCsv,
  invoicePdfs,
  taxReport,
  taxReportCsv,
} from "@idf/db/accounting";
import { canSeeAll } from "@idf/db/admin";
import { pool } from "../../../../lib/db";
import { currentUser } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** Downloads der Buchhaltung: ?art=rechnungen|steuer|pdf&von=JJJJ-MM-TT&bis=JJJJ-MM-TT */
export async function GET(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user || !canSeeAll(user)) return new Response("Keine Berechtigung", { status: 403 });
  const q = new URL(req.url).searchParams;
  const period = { from: q.get("von") ?? "", to: q.get("bis") ?? "" };
  const art = q.get("art");
  const base = `${period.from}_bis_${period.to}`;
  const headers = (type: string, name: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "private, no-store",
  });
  try {
    if (art === "rechnungen") {
      const csv = invoiceLinesCsv(await invoiceLines(pool(), user, period));
      return new Response(csv, { headers: headers("text/csv; charset=utf-8", `Rechnungen_${base}.csv`) });
    }
    if (art === "steuer") {
      const csv = taxReportCsv(await taxReport(pool(), user, period));
      return new Response(csv, { headers: headers("text/csv; charset=utf-8", `Steuerbericht_${base}.csv`) });
    }
    if (art === "pdf") {
      const zip = buildZip(await invoicePdfs(pool(), user, period));
      return new Response(new Uint8Array(zip), { headers: headers("application/zip", `Rechnungen_${base}.zip`) });
    }
    return new Response("Unbekannter Export", { status: 400 });
  } catch (err) {
    if (err instanceof AccountingError) return new Response(err.message, { status: 400 });
    console.error("Export der Buchhaltung fehlgeschlagen", (err as Error).message);
    return new Response("Export nicht möglich", { status: 500 });
  }
}
