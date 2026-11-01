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

## Übernahme aus Thrivecart

Die öffentlichen Thrivecart-Kaufseiten (ohne Login gesichert, Ordner mit
`html/<slug>.html` und `bilder/<dateiname>`) lassen sich als Ausgangspunkt übernehmen:

```
DATABASE_URL=… pnpm db:kaufseiten:thrivecart /absoluter/pfad/idf-thrivecart-seiten          # Probelauf
DATABASE_URL=… pnpm db:kaufseiten:thrivecart /absoluter/pfad/idf-thrivecart-seiten --schreiben
```

- Zuordnung über den Slug (`app.products.slug` = Thrivecart-Adresse).
- Übernommen werden Logo, Überschrift, Unterzeile, Knopftext, Titelbild sowie
  Überschriften, Texte, Aufzählungen, Bilder und „Person mit Bild“-Abschnitte. Zeilen
  mit ✅ werden Vertrauenshinweise.
- Nicht übernommen: Formular, Preise, Gutscheinfeld, Knöpfe, Rechtstexte, Fußzeile,
  ausgeblendete Elemente und Thrivecart-Platzhalter.
- Produkte mit eigener Seite bleiben unverändert. Mit `--ueberschreiben` werden nur Seiten neu übernommen, die noch niemand im Editor bearbeitet hat.
- Gibt es noch keine Standardseite, bekommt sie das häufigste Logo.
- Seiten, die Thrivecart nicht mehr ausliefert (404), werden gemeldet und ausgelassen.

## Gestaltung (Brandbook)

Kaufseiten und Verwaltung folgen dem Brandbook „Investiere Dich Frei – Emilia Bolda“
(Juli 2025) und dem Aufbau der Thrivecart-Seite /her/:

- Farben: Black #363636 (Text), Dark Rose #A26766 (Knöpfe, Akzente), Rosé #D29E9F,
  Soft Rose #FFCCCC (Dekoration), Light Grey #EEE9E7 (Bestellbereich, Hintergrund
  der Verwaltung). Alle als CSS-Variablen in `apps/web/app/globals.css`.
- Schriften: Playfair Display für Überschriften, Raleway für Unterzeilen und Text.
  Sie liegen auf unserem Server (`apps/web/public/schriften`), es geht nichts an Google.
- Logos aus dem Brandbook unter `apps/web/public/marke` (bunt, weiß, Bildmarke).
  Ohne eigenes Logo im Editor zeigt die Kaufseite das bunte Logo.
- Aufbau der Kaufseite nach der Vermessung von Thrivecart /her/ (01.11.2026): durchgehend
  hellgrauer Grund, Logo mittig, Kopfbereich (Text links, Bild rechts mit Schatten, Bogen
  und Punktraster), Abschnitt über der Bestellung (Bereich „mitte“, Bild links und
  Aufzählung rechts), Bestellbereich (Inhalt links, Bestellbox in Rosé rechts, Felder mit
  Beschriftung im Feld, keine sichtbaren Schritte), Bereich unten (Emilia), schlichte
  graue Fußzeile. Knöpfe rund, ohne Hover-Effekt.
- Der Thrivecart-Import legt Abschnitte vor dem Bestellbereich in „mitte“ ab. Ein erneuter
  Import mit `--ueberschreiben` ändert nur Seiten, die noch niemand im Editor bearbeitet hat.

## Schutz gegen Kartentests und Massenbestellungen

Ohne fremden Captcha-Dienst und ohne Cookies (Migration 0030, `apps/web/lib/order-guard.ts`):

- **Rechenaufgabe:** Jede Kaufseite bekommt eine vom Server signierte Aufgabe. Der Browser löst sie
  im Hintergrund in ein bis drei Sekunden, während die Kundin das Formular ausfüllt; erst dann ist
  der Bestellknopf aktiv. Jede Aufgabe gilt eine Stunde und nur für einen Bestellversuch.
- **Grenzen je Stunde:** höchstens 10 Bestellversuche je IP-Adresse, 5 je E-Mail-Adresse und
  30 Gutscheinprüfungen je IP-Adresse. Danach kommt ein Hinweis mit der Service-Adresse.
- **Datenschutz:** In `app.request_counters` stehen nur HMAC-Werte, nie IP- oder E-Mail-Adressen.
  Der Schlüssel kommt aus `CHECKOUT_POW_SECRET`, sonst aus `DATABASE_URL`.
- Die Kartenprüfung selbst schützt zusätzlich Stripe Radar.
