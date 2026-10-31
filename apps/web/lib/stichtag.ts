import type pg from "pg";

// Stichtag für den Einzug, nur für Tests in der Testdatenbank.
// Ohne Stichtag zieht der Lauf zum heutigen Tag (Berlin) ein.

/** Liest `--stichtag YYYY-MM-DD` aus den Argumenten; null, wenn nicht angegeben. */
export function parseStichtag(argv: string[]): string | null {
  const i = argv.findIndex((a) => a === "--stichtag" || a.startsWith("--stichtag="));
  if (i < 0) return null;
  const arg = argv[i] ?? "";
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--stichtag erwartet ein Datum im Format JJJJ-MM-TT");
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error(`Ungültiges Datum für --stichtag: ${value}`);
  return value;
}

/**
 * Bricht ab, wenn die Datenbank keine Testdatenbank ist: Ihr Name muss „test“ enthalten,
 * und jede Gesellschaft muss im Testbetrieb stehen (payments_mode = 'test').
 */
export async function assertTestDatabase(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ db: string; companies: number; live: number }>(
    `select current_database() as db,
            count(*)::int as companies,
            count(*) filter (where payments_mode <> 'test')::int as live
       from app.companies`,
  );
  const { db, companies, live } = rows[0] ?? { db: "", companies: 0, live: 0 };
  if (!/test/i.test(db)) throw new Error(`Stichtag nur in einer Testdatenbank erlaubt, diese heißt „${db}“`);
  if (companies === 0) throw new Error("Stichtag abgelehnt: keine Gesellschaft angelegt");
  if (live > 0) throw new Error(`Stichtag abgelehnt: ${live} Gesellschaft(en) nicht im Testbetrieb (payments_mode)`);
}
