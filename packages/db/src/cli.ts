import pg from "pg";
import { migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const done = await migrate(client);
  console.log(done.length ? `Eingespielt: ${done.join(", ")}` : "Datenbank ist aktuell");
} finally {
  await client.end();
}
