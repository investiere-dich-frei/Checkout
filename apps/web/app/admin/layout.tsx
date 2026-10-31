import type { ReactNode } from "react";
import { canSeeAll } from "@idf/db/admin";
import { currentUser } from "../../lib/session";
import { logoutAction } from "./actions";
import { NavLinks } from "./nav-links";

export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { admin: "Admin", vertrieb: "Vertrieb", freelancer: "Freelancer", pruefer: "Prüfung" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const links = user
    ? [
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/bestellungen", label: "Bestellungen" },
        ...(canSeeAll(user) ? [{ href: "/admin/produkte", label: "Produkte" }, { href: "/admin/gutscheine", label: "Gutscheine" }] : []),
        { href: "/admin/kauflinks", label: "Kauflinks" },
        ...(user.role === "admin" ? [{ href: "/admin/seiten", label: "Kaufseiten" }] : []),
      ]
    : [];
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-top-inner">
          <a href="/admin" aria-label="Verwaltung – Dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="site-logo" src="/marke/logo-bunt.png" alt="Investiere Dich Frei" />
          </a>
          {user && (
            <>
              <nav className="admin-nav" aria-label="Verwaltung">
                <NavLinks links={links} />
              </nav>
              <div className="admin-user">
                <span>
                  {user.displayName} · {ROLE[user.role]}
                </span>
                <form action={logoutAction}>
                  <button type="submit" className="link-button">
                    Abmelden
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </header>
      <div className="admin-body">{children}</div>
    </div>
  );
}
