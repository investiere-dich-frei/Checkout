import { listOrders } from "@idf/db/admin";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/session";
import { OrderTable } from "../order-table";

export default async function OrdersPage(props: { searchParams: Promise<{ q?: string; seite?: string }> }) {
  const user = await requireUser();
  const { q, seite } = await props.searchParams;
  const page = Math.max(1, Number(seite) || 1);
  const orders = await listOrders(pool(), user, { search: q, limit: 50, offset: (page - 1) * 50 });
  return (
    <section className="card">
      <h1>Bestellungen</h1>
      <form className="inline-form" role="search">
        <label htmlFor="q">Suche nach Name, E-Mail, Produkt oder Bestellnummer</label>
        <input id="q" name="q" type="search" defaultValue={q ?? ""} />
        <button type="submit">Suchen</button>
      </form>
      <OrderTable orders={orders} />
      <p>
        {page > 1 && <a href={`?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page - 1) })}`}>Zurück</a>}{" "}
        {orders.length === 50 && <a href={`?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page + 1) })}`}>Weiter</a>}
      </p>
    </section>
  );
}
