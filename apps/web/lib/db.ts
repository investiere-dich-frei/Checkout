import pg from "pg";

// Eine Verbindung pro Prozess; im Entwicklungsmodus übersteht sie das Neuladen.
const globalForPool = globalThis as unknown as { idfPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.idfPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL fehlt");
    globalForPool.idfPool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return globalForPool.idfPool;
}

/** Führt fn in einer Transaktion aus, mit handelnder Stelle für das Audit-Log. */
export async function transaction<T>(actor: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', $1, true)`, [actor]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
