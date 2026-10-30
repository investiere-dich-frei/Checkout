# Anforderungen

Stand 29.10.2026. Grundlage ist die Funktionsanalyse im Projekt-Dokument „Eigene Thrivecart-Alternative: Funktionsanalyse & Bauplan“.

## Zweck und Nutzer

- Nur für die eigene Nutzung der Investiere Dich Frei GmbH, kein Verkauf, keine Mandanten.
- Nutzer:
  - **Admin**: Christian
  - **Vertrieb**: Vertriebsmitarbeiter, bekommen eigene Kauflinks
  - **Freelancer**: wie Vertrieb, aber zeitlich begrenzt
  - **Prüfer**: nur Lesezugriff, für Steuerberatung und Betriebsprüfung
- Vertriebsleute schicken Kauflinks und nutzen den Checkout live im Verkaufsgespräch.
- Jede Bestellung hält fest, über welche Vertriebsperson sie kam (Verkäufernachweis).

## Muss in Phase 1

- Produkte mit Einmalzahlung, Raten, Anzahlung und Abo; Preise immer in Cent.
- Checkout nach deutschem Recht:
  - Button „zahlungspflichtig bestellen“ (§ 312j BGB);
  - Widerrufsbelehrung und Verzicht bei digitalen Inhalten (§ 356 Abs. 5 BGB);
  - Widerrufsbutton (§ 356a BGB, ab 19.06.2026);
  - Kündigungsbutton (§ 312k BGB).
- Zahlungen über Stripe, PayPal und Überweisung.
- Rechnungen nach GoBD in einem eigenen, lückenlosen Nummernkreis mit Vorsilbe: IDF-1, IDF-2, …
  Thrivecart schreibt im Parallelbetrieb weiter Rechnungen mit eigenen Nummern; ein Anschluss an
  dessen Kreis würde doppelte Nummern erzeugen (Entscheidung Christian, 29.10.2026).
  Die Steuerberatung soll das vor dem ersten Verkauf bestätigen.
- Umsatzsteuer:
  - DE 19 %, AT 20 %, CH ohne deutsche USt;
  - Steuerbefreiung nach § 4 Nr. 21 UStG je Produkt;
  - OSS-Auswertung.

## Mengengerüst (Thrivecart, Oktober 2026)

| Größe | Wert |
|---|---|
| Aktive Produkte | 107 |
| Preisoptionen | 603 |
| Aktive Abos und Ratenpläne | 559 |
| Bestellungen gesamt | 3.840 |
| Länder | 82 % DE, 11 % AT, 6 % CH |
| Fehlgeschlagene Zahlungen in 12 Monaten | 277 |

Bei diesen Mengen reicht ein einzelner Datenbankserver mit Replikat bei Weitem aus.

## Nicht im Umfang

- Kursbereich: Kurse bleiben in LearningSuite.
- Affiliate-Programm: In Thrivecart hatte es 0 Verkäufe.
