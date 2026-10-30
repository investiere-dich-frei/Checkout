import { sessionUser, type SessionUser } from "@idf/db/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "./db";

export const SESSION_COOKIE = "idf_sitzung";

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return sessionUser(pool(), jar.get(SESSION_COOKIE)?.value);
}

/** Für Seiten der Verwaltung: ohne Anmeldung zur Anmeldeseite. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/admin/anmelden");
  return user;
}
