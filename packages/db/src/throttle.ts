import type pg from "pg";

/**
 * Einfache Zähler je Stunde, z. B. Bestellungen je IP-Adresse. Der Aufrufer übergibt einen
 * HMAC-Wert statt der Adresse selbst. hit() zählt hoch und gibt den neuen Stand zurück.
 */

type Db = pg.Pool | pg.ClientBase;

export type CounterScope = "bestellung_ip" | "bestellung_email" | "gutschein_ip" | "rechenaufgabe";

export async function hit(db: Db, scope: CounterScope, keyHash: Buffer): Promise<number> {
  const { rows } = await db.query<{ hits: number }>(
    `insert into app.request_counters (scope, key_hash, window_start, hits) values ($1, $2, date_trunc('hour', now()), 1)
     on conflict (scope, key_hash, window_start) do update set hits = app.request_counters.hits + 1
     returning hits`,
    [scope, keyHash],
  );
  return rows[0]!.hits;
}
