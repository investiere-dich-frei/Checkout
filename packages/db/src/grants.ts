import { readFile } from "node:fs/promises";
import type pg from "pg";

/** Rechte der Anwendungsrolle setzen (grants.sql). */
export async function applyGrants(client: pg.ClientBase) {
  await client.query(await readFile(new URL("../grants.sql", import.meta.url), "utf8"));
}
