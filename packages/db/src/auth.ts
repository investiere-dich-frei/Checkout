import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

/**
 * Anmeldung per E-Mail-Link. Link und Sitzung sind zufällige 32 Byte; in der
 * Datenbank liegen nur ihre SHA-256-Hashes.
 */

export type Role = "admin" | "vertrieb" | "freelancer" | "pruefer";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  salesCode: string | null;
}

export const LOGIN_LINK_MINUTES = 15;
export const SESSION_DAYS = 14;

const hash = (value: string) => createHash("sha256").update(value).digest();
const token = () => randomBytes(32).toString("base64url");

/**
 * Anmeldelink anfordern. Gibt es die Adresse nicht (oder ist sie gesperrt), passiert
 * nichts, und der Aufrufer zeigt trotzdem dieselbe Meldung: So lässt sich nicht
 * herausfinden, welche Adressen Zugang haben.
 */
export async function requestLogin(client: pg.ClientBase, email: string, baseUrl: string): Promise<boolean> {
  const user = (
    await client.query<{ id: string; email: string; display_name: string }>(
      `select id, email, display_name from app.users where lower(email) = lower($1) and active`,
      [email.trim()],
    )
  ).rows[0];
  if (!user) return false;
  const t = token();
  await client.query(`insert into app.login_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + $3 * interval '1 minute')`, [
    user.id,
    hash(t),
    LOGIN_LINK_MINUTES,
  ]);
  const link = `${baseUrl}/admin/anmelden/${t}`;
  await client.query(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text) values ('anmeldung', $1, $2, $3)`,
    [
      user.email.toLowerCase(),
      "Dein Anmeldelink",
      [
        `Hallo ${user.display_name},`,
        "",
        `hier ist dein Link zur Anmeldung. Er gilt ${LOGIN_LINK_MINUTES} Minuten und nur einmal:`,
        link,
        "",
        "Wenn du keine Anmeldung angefordert hast, ignoriere diese E-Mail.",
      ].join("\n"),
    ],
  );
  return true;
}

/** Link einlösen: einmalig und nur innerhalb der Gültigkeit. Gibt das Sitzungsgeheimnis für das Cookie zurück. */
export async function redeemLogin(client: pg.ClientBase, loginToken: string): Promise<{ session: string; expiresAt: Date } | null> {
  const r = await client.query<{ id: string; user_id: string }>(
    `update app.login_tokens t set used_at = now()
       from app.users u
      where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and u.id = t.user_id and u.active
     returning t.id, t.user_id`,
    [hash(loginToken)],
  );
  const row = r.rows[0];
  if (!row) return null;
  const s = token();
  const expires = await client.query<{ expires_at: Date }>(
    `insert into app.sessions (user_id, session_hash, expires_at) values ($1, $2, now() + $3 * interval '1 day') returning expires_at`,
    [row.user_id, hash(s), SESSION_DAYS],
  );
  return { session: s, expiresAt: expires.rows[0]!.expires_at };
}

export async function sessionUser(client: pg.Pool | pg.ClientBase, session: string | undefined): Promise<SessionUser | null> {
  if (!session) return null;
  const r = await client.query<{ id: string; email: string; display_name: string; role: Role; sales_code: string | null }>(
    `select u.id, u.email, u.display_name, u.role, u.sales_code
       from app.sessions s join app.users u on u.id = s.user_id
      where s.session_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.active`,
    [hash(session)],
  );
  const u = r.rows[0];
  return u ? { id: u.id, email: u.email, displayName: u.display_name, role: u.role, salesCode: u.sales_code } : null;
}

export async function endSession(client: pg.Pool | pg.ClientBase, session: string) {
  await client.query(`update app.sessions set revoked_at = now() where session_hash = $1 and revoked_at is null`, [hash(session)]);
}
