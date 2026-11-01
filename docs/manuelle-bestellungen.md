# Manuelle Bestellungen (Rechnung vorab, Überweisung)

Stand 01.11.2026. Ersetzt die n8n-Abläufe „IDF Manuelle Bestellung – Formular v12“, „– Verarbeitung“ und „– Storno“.
Verwaltung → **Manuelle Bestellungen** (`/admin/manuell`).

## Wofür

Für Kundinnen, die erst eine Rechnung möchten und dann überweisen. Der Vertrieb vereinbart Betrag und
Zahlungsplan im Gespräch; der Preis muss nicht zu einer Preisoption im Shop passen.

## Ablauf

1. **Anlegen** (Admin, Vertrieb, Freelancer): Produkt, Kundin, Gesamtbetrag brutto, Zahlungsmodell, Zahlungsziel.
   - Zahlungsmodelle wie in n8n: Einmalzahlung, Anzahlung + Restzahlung, Anzahlung + Raten, Ratenzahlung (2–24 Raten).
   - Die erste Zahlung ist zum Zahlungsziel fällig (Vorgabe 14 Tage), weitere Zahlungen ab der „nächsten Fälligkeit“ monatlich zum gleichen Tag.
   - Steuer je Produkt und Land wie im Checkout (`decideTax`), Betrag gilt als brutto. Reverse Charge nur mit per VIES geprüfter USt-IdNr.
   - Sofort entsteht **eine Rechnung über den Gesamtbetrag** im Kreis IDF-n, mit Zahlungsplan, Bankverbindung und der Rechnungsnummer als Verwendungszweck.
     Das entspricht n8n („Umsatz und Rechnung immer über den Gesamtbetrag“).
   - PDF und E-Mail an die Kundin (von buchhaltung@) mit Widerrufsbelehrung und AGB im Wortlaut (dauerhafter Datenträger).
   - Vertrieb und Freelancer legen immer für sich selbst an (Verkäufernachweis); Admins wählen die Vertriebsperson.
   - Ist die erste Zahlung schon da (früher „Überweisung erfassen“), kann ein Admin das gleich mit angeben. Die Rechnung sagt dann „bezahlt am …“.
2. **Zahlung verbuchen** (nur Admin): je Fälligkeit, der Reihe nach, mit Eingangsdatum und optionaler Referenz.
   Es entsteht keine weitere Rechnung. n8n bekommt `zahlung.eingegangen` (Kurszugang, HubSpot) mit `payment.provider = "ueberweisung"`.
3. **Stornieren** (nur Admin, mit internem Grund):
   - Stornorechnung über den vollen Betrag (umgekehrte Positionen), PDF, auf Wunsch Mail an die Kundin.
   - Offene Zahlungen entfallen, Bestellung „storniert“.
   - Ohne Zahlungseingang ist nichts weiter zu tun. Mit Zahlungseingang meldet das System `bestellung.beendet` (Zugang endet) und zeigt „Rückzahlung offen“.
4. **Rückzahlung verbuchen** (nur Admin), nachdem das Geld zurücküberwiesen ist: negative Zahlung, Bestellung „erstattet“, `zahlung.erstattet` an n8n.

Nicht automatisch: Mahnung und Storno nach Fristablauf. Überfällige Rechnungen stehen im Reiter „Überfällig“.

## Schutz

- Bestellungen per Rechnung lassen sich nicht per Karte oder PayPal bezahlen und werden nie automatisch eingezogen
  (`nextPaymentTarget`, `cardSetupTarget`, `dueCharges`, `recordInstallmentPayment`).
- Je Produkt gibt es eine verdeckte Preisoption „Manuelle Bestellung (Betrag laut Rechnung)“ (`manual_only`), die sich nicht einschalten lässt.
- `app.manual_orders`: Storno und Rückzahlung lassen sich genau einmal nachtragen, sonst ist alles fest; kein Löschen.
- `app.manual_order_events`: Verlauf (angelegt, Zahlung, Storno, Rückzahlung), unveränderbar. Alles steht zusätzlich im Audit-Log.

## Bankverbindung

`app.companies.bank_name`, `iban`, `bic`. Migration 0023 trägt die Bankverbindung aus den bisherigen n8n-Rechnungen ein
(Hannoversche Volksbank). Sie kommt über den Schnappschuss der Gesellschaft unverändert in jede Rechnung.
