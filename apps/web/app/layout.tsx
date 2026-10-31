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
          <div className="site-header-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="site-logo" src="/marke/logo-bunt.png" alt="Investiere Dich Frei – Die Emilia Bolda Finanzakademie" />
          </div>
        </header>
        <main id="inhalt">{children}</main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="site-footer-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marke/logo-weiss.png" alt="" />
            </div>
            <a href="https://www.investieredichfrei.de/rechtliches/impressum">Impressum</a>
            <a href="https://www.investieredichfrei.de/rechtliches/datenschutzerklaerung">Datenschutz</a>
            <a href="https://www.investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen">AGB</a>
            <a href="https://www.investieredichfrei.de/rechtliches/widerrufsbelehrungen">Widerrufsbelehrung</a>
            <a href="/vertraege-kuendigen">Verträge hier kündigen</a>
            <a href="/vertrag-widerrufen">Vertrag widerrufen</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
