import { toCsv } from "@idf/db/accounting";
import { canSeeAll, listOrders } from "@idf/db/admin";
import { pool } from "../../../../lib/db";
import { todayBerlin } from "../../../../lib/format";
import { readOrderFilter } from "../../../../lib/order-filter";
import { currentUser } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** Höchstens so viele Zeilen je Export; für mehr den Zeitraum einschränken. */
const MAX_ROWS = 10000;

const cents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

/** Gefilterte Bestellliste als CSV (Semikolon, UTF-8 mit BOM, für Excel). Nur Admins. */
export async function GET(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user || !canSeeAll(user)) return new Response("Keine Berechtigung", { status: 403 });
  const filter = readOrderFilter(new URL(req.url).searchParams);
  const orders = await listOrders(pool(), user, { ...filter, today: todayBerlin(), limit: MAX_ROWS + 1 });
  if (orders.length > MAX_ROWS) {
    return new Response(`Mehr als ${MAX_ROWS} Bestellungen. Bitte den Zeitraum einschränken.`, { status: 400 });
  }
  const csv = toCsv(
    ["Datum", "Bestellung", "Kundin", "E-Mail", "Produkt", "Preisoption", "Währung", "Gesamt", "Bezahlt", "Status", "Vertrieb"],
    orders.map((o) => [
      berlin.format(o.createdAt),
      o.id,
      o.customerName,
      o.email,
      o.product,
      o.option,
      o.currency,
      cents(o.totalCents),
      cents(o.paidCents),
      o.status,
      o.seller,
    ]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Bestellungen_${todayBerlin()}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
