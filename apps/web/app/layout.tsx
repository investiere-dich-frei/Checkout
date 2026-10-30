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
          <a href="https://www.investieredichfrei.de/rechtliches/impressum">Impressum</a>
          <a href="https://www.investieredichfrei.de/rechtliches/datenschutzerklaerung">Datenschutz</a>
          <a href="https://www.investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen">AGB</a>
          <a href="https://www.investieredichfrei.de/rechtliches/widerrufsbelehrungen">Widerrufsbelehrung</a>
          <a href="/vertraege-kuendigen">Verträge hier kündigen</a>
          <a href="/vertrag-widerrufen">Vertrag widerrufen</a>
        </footer>
      </body>
    </html>
  );
}
