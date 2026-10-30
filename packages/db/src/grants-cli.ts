import pg from "pg";
import { applyGrants } from "./grants.ts";

// Setzt die Rechte der Anwendungsrolle idf_app (grants.sql). Läuft als idf_migrator nach der Migration.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt");
  process.exit(2);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await applyGrants(client);
  console.log("Rechte für idf_app gesetzt");
} finally {
  await client.end();
}
