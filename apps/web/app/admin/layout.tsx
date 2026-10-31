import type { ReactNode } from "react";
import { canSeeAll } from "@idf/db/admin";
import { currentUser } from "../../lib/session";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { admin: "Admin", vertrieb: "Vertrieb", freelancer: "Freelancer", pruefer: "Prüfung" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <div className="admin">
      {user && (
        <nav className="admin-nav" aria-label="Verwaltung">
          <a href="/admin">Übersicht</a>
          <a href="/admin/bestellungen">Bestellungen</a>
          {canSeeAll(user) && <a href="/admin/produkte">Produkte</a>}
          <a href="/admin/kauflinks">Kauflinks</a>
          {user.role === "admin" && <a href="/admin/seiten">Kaufseiten</a>}
          <span className="note">
            {user.displayName} · {ROLE[user.role]}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="link-button">
              Abmelden
            </button>
          </form>
        </nav>
      )}
      {children}
    </div>
  );
}
