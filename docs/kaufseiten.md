# Kaufseiten gestalten

Die Kaufseiten unter `/kaufen/<produkt>/<preisoption>` sind aufgebaut wie die
Thrivecart-Seiten von IDF:

1. **Kopfbereich**: Logo, große Überschrift, Unterzeile, Knopf „Jetzt anmelden“
   (springt zum Formular) und optional ein Titelbild rechts daneben.
2. **Zwei Spalten**: links Inhalte (Leistungen, Bilder, Kundenstimmen), rechts das
   Bestellformular mit den Schritten „01 Deine Angaben“ und „02 Zahlung“.
3. **Unten** über die ganze Breite, z. B. „Über Emilia“.

## Editor

Admins öffnen in der Verwaltung **Kaufseiten** (`/admin/seiten`).

- **Standardseite**: gilt für alle Produkte ohne eigene Seite. Ihr Logo erscheint
  auch auf Produktseiten ohne eigenes Logo.
- **Produktseite**: Ein Klick auf ein Produkt öffnet den Editor. Mit „Speichern“
  bekommt das Produkt eine eigene Seite. „Vorlage übernehmen“ kopiert den Inhalt
  einer anderen Seite (z. B. Masterclass D → Masterclass OE).
- Bausteine: Überschrift, Text, Aufzählung, Bild, Zitat/Kundenstimme, Person mit
  Bild, Vertrauenshinweise mit Häkchen. Jeder Baustein steht links, rechts über dem
  Formular oder unten. Texte: Leerzeile = neuer Absatz, `**so**` = fett.
- Die Vorschau rechts zeigt jede Änderung sofort; gültig wird sie erst mit „Speichern“.

Nicht änderbar (rechtlich und für die Buchhaltung): Preise, Raten und Steuer, der
Bestellknopf „Zahlungspflichtig bestellen“, AGB-, Datenschutz- und Widerrufstexte.

## Technik

- Tabelle `app.checkout_pages` (Migration 0021): eine Zeile je Produkt, eine ohne
  Produkt für die Standardseite; Inhalt als jsonb, geprüft durch
  `packages/db/src/checkout-page-content.ts`. Änderungen stehen im Audit-Log.
- Bilder in `app.checkout_images` (PNG, JPG, WebP, GIF, höchstens 3 MB), ausgeliefert
  unter `/bilder/<id>`. Das Format wird am Dateiinhalt erkannt; Bilder werden nie
  geändert, gleiche Dateien nur einmal gespeichert. Sie liegen in der Datenbank und
  sind damit in der Sicherung.
- Texte werden nie als HTML übernommen.
- Ist eine gespeicherte Seite nicht lesbar, zeigt der Checkout die Vorgabe statt
  eines Fehlers: Ein Gestaltungsfehler verhindert nie einen Verkauf.
