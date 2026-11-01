import type pg from "pg";
import { requestLogin, type Role, type SessionUser } from "./auth.ts";

/**
 * Team: Personen mit Zugang zur Verwaltung anlegen, Rolle und Kürzel ändern, sperren.
 * Nur Admins. Änderungen stehen im Audit-Log (Tabelle app.users). Die E-Mail-Adresse ist die
 * Anmeldung und bleibt fest; für eine neue Adresse eine neue Person anlegen und die alte sperren.
 * Sperren beendet alle Sitzungen der Person sofort.
 */

type Db = pg.Pool | pg.ClientBase;

export class TeamError extends Error {}

export const ROLES: Role[] = ["admin", "vertrieb", "freelancer", "pruefer"];

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  salesCode: string | null;
  active: boolean;
  createdAt: Date;
  lastLogin: Date | null;
}

const SALES_CODE = /^[a-z0-9-]{2,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function assertAdmin(user: SessionUser) {
  if (user.role !== "admin") throw new TeamError("Keine Berechtigung");
}

export async function listTeam(db: Db, user: SessionUser): Promise<TeamMember[]> {
  assertAdmin(user);
  const { rows } = await db.query(
    `select u.id, u.email, u.display_name, u.role, u.sales_code, u.active, u.created_at,
            (select max(s.created_at) from app.sessions s where s.user_id = u.id) last_login
       from app.users u order by u.active desc, u.display_name`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    salesCode: r.sales_code,
    active: r.active,
    createdAt: r.created_at,
    lastLogin: r.last_login,
  }));
}

function clean(input: { displayName: string; role: string; salesCode: string }) {
  const displayName = input.displayName.trim();
  if (!displayName) throw new TeamError("Bitte einen Namen angeben");
  if (!ROLES.includes(input.role as Role)) throw new TeamError("Unbekannte Rolle");
  const salesCode = input.salesCode.trim().toLowerCase() || null;
  if (salesCode && !SALES_CODE.test(salesCode)) throw new TeamError("Kürzel: 2 bis 32 Zeichen, nur a–z, 0–9 und Bindestrich");
  if ((input.role === "vertrieb" || input.role === "freelancer") && !salesCode) {
    throw new TeamError("Vertrieb und Freelancer brauchen ein Kürzel für ihre Kauflinks");
  }
  return { displayName, role: input.role as Role, salesCode };
}

const uniqueMessage = (err: unknown): never => {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23505") {
    throw new TeamError(e.constraint?.includes("sales_code") ? "Dieses Kürzel ist schon vergeben" : "Diese E-Mail-Adresse hat schon Zugang");
  }
  throw err;
};

/** Person anlegen und gleich einen Anmeldelink schicken (wenn baseUrl gesetzt ist). */
export async function createTeamMember(
  client: pg.ClientBase,
  user: SessionUser,
  input: { email: string; displayName: string; role: string; salesCode: string },
  baseUrl: string | null,
): Promise<string> {
  assertAdmin(user);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new TeamError("Bitte eine gültige E-Mail-Adresse angeben");
  const v = clean(input);
  const exists = await client.query(`select 1 from app.users where lower(email) = $1`, [email]);
  if (exists.rowCount) throw new TeamError("Diese E-Mail-Adresse hat schon Zugang");
  const id = await client
    .query<{ id: string }>(`insert into app.users (email, display_name, role, sales_code) values ($1, $2, $3, $4) returning id`, [
      email,
      v.displayName,
      v.role,
      v.salesCode,
    ])
    .then((r) => r.rows[0]!.id)
    .catch(uniqueMessage);
  if (baseUrl) await requestLogin(client, email, baseUrl);
  return id;
}

/** Name, Rolle, Kürzel und Sperre ändern. Gibt true zurück, wenn sich etwas geändert hat. */
export async function updateTeamMember(
  client: pg.ClientBase,
  user: SessionUser,
  id: string,
  input: { displayName: string; role: string; salesCode: string; active: boolean },
): Promise<boolean> {
  assertAdmin(user);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TeamError("Person gibt es nicht");
  const v = clean(input);
  // Sperrt die Admin-Liste, damit zwei Admins sich nicht gleichzeitig gegenseitig entfernen.
  await client.query(`select pg_advisory_xact_lock(hashtextextended('team-admins', 0))`);
  const old = (await client.query(`select display_name, role, sales_code, active from app.users where id = $1 for update`, [id])).rows[0];
  if (!old) throw new TeamError("Person gibt es nicht");
  if (id === user.id && (v.role !== "admin" || !input.active)) throw new TeamError("Die eigene Rolle und den eigenen Zugang kann man nicht ändern");
  if (old.role === "admin" && old.active && (v.role !== "admin" || !input.active)) {
    const admins = await client.query<{ n: number }>(`select count(*)::int n from app.users where role = 'admin' and active`);
    if (admins.rows[0]!.n <= 1) throw new TeamError("Es muss mindestens ein Admin übrig bleiben");
  }
  if (old.display_name === v.displayName && old.role === v.role && old.sales_code === v.salesCode && old.active === input.active) return false;
  await client
    .query(`update app.users set display_name = $2, role = $3, sales_code = $4, active = $5 where id = $1`, [id, v.displayName, v.role, v.salesCode, input.active])
    .catch(uniqueMessage);
  // Gesperrt oder andere Rolle: laufende Sitzungen beenden, damit alte Rechte nicht weiter gelten.
  if (!input.active || old.role !== v.role) {
    await client.query(`update app.sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [id]);
  }
  return true;
}
