import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(join(dir, file), "utf8");
      return {
        version: file.slice(0, 4),
        name: file.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

/**
 * Spielt fehlende Migrationen ein, jede in einer eigenen Transaktion.
 * Eine bereits eingespielte Migration darf nie mehr geändert werden:
 * weicht ihre Prüfsumme ab, bricht der Lauf ab.
 */
export async function migrate(client: pg.ClientBase, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(`
    create table if not exists public.schema_migrations (
      version    text primary key,
      name       text not null,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);
  // Verhindert, dass zwei Deployments gleichzeitig migrieren.
  await client.query("select pg_advisory_lock(hashtext('schema_migrations'))");
  try {
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from public.schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const done: string[] = [];

    for (const m of await loadMigrations(dir)) {
      const known = applied.get(m.version);
      if (known !== undefined) {
        if (known !== m.checksum) {
          throw new Error(`Migration ${m.name} wurde nach dem Einspielen verändert (Prüfsumme weicht ab)`);
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into public.schema_migrations (version, name, checksum) values ($1, $2, $3)", [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${m.name} fehlgeschlagen: ${(err as Error).message}`, { cause: err });
      }
      done.push(m.name);
    }
    return done;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('schema_migrations'))");
  }
}
