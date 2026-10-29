import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Investiere Dich Frei – Bestellung",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="site-header">
          <span className="brand">Investiere Dich Frei</span>
        </header>
        <main id="inhalt">{children}</main>
        <footer className="site-footer">
          <a href="https://www.investieredichfrei.de/impressum">Impressum</a>
          <a href="https://www.investieredichfrei.de/datenschutz">Datenschutz</a>
          <a href="/vertraege-kuendigen">Verträge hier kündigen</a>
        </footer>
      </body>
    </html>
  );
}
