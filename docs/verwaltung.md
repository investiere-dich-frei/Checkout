# Verwaltung

Unter `/admin` (nur mit Anmeldung).

## Anmeldung

- Ohne Passwort: E-Mail-Adresse eingeben, Link kommt per E-Mail, 15 Minuten gültig, nur einmal.
- Der Link führt auf eine Seite mit „Jetzt anmelden“. Der Klick ist nötig, weil Mailprogramme Links vorab aufrufen.
- Die Sitzung gilt 14 Tage. In der Datenbank liegen nur Hashes von Link und Sitzung.
- Zugang hat, wer in `app.users` aktiv ist. Neue Nutzer legt bis auf Weiteres ein Admin per SQL an.

## Rollen

| Rolle | Sieht | Darf |
| --- | --- | --- |
| Admin | alle Bestellungen, offene Arbeit | Kündigungen erledigen, Abos beenden |
| Prüfung (Steuerberatung, Betriebsprüfung) | alle Bestellungen, offene Arbeit | nur lesen |
| Vertrieb, Freelancer | nur Bestellungen über eigene Kauflinks | Kauflinks abrufen |

## Seiten

- **Übersicht**: offene Kündigungen und Widerrufe, Zahlungen zur Prüfung, dreimal gescheiterte Einzüge, neueste Bestellungen.
- **Bestellungen**: Suche nach Name, E-Mail, Produkt oder Bestellnummer, dazu Filter nach Bestellzeitraum, Lage
  (überfällig, pausiert, Abos, Ratenpläne, Einmalzahlung), Status, Zahlungsart, Produkt, Land und (nur Admin, Prüfung)
  Vertrieb. Die Filter stehen in der Adresse, die Ansicht lässt sich also als Lesezeichen speichern. Admin und Prüfung
  können die gefilterte Liste als CSV herunterladen (höchstens 10.000 Zeilen). Detailseite mit Zahlplan, Rechnungen
  (PDF), Kündigungen und Einzugsversuchen.
- **Manuelle Bestellungen**: Rechnung vorab, Zahlung per Überweisung, mit Zahlung verbuchen, Storno und Rückzahlung; siehe [manuelle-bestellungen.md](manuelle-bestellungen.md).
- **Kauflinks**: alle freigeschalteten Angebote mit dem Kürzel der angemeldeten Person.
- **Kunden** (Admin, Prüfung): Suche nach Name, E-Mail, Firma oder Ort. Eine Kundin ist die Gruppe aller
  Kundendatensätze mit derselben E-Mail-Adresse (jede Bestellung legt einen eigenen an). Die Kundenseite zeigt
  alle neuen Käufe, die Alt-Käufe und Alt-Abos aus Thrivecart (nur lesen) und den abgerechneten Umsatz.

## Kundenservice

- **Kontaktdaten ändern** (nur Admin, auf der Kundenseite): Name, Firma, E-Mail und Anschrift, für alle
  Datensätze der Kundin. Gilt für künftige Rechnungen und Mails; ausgestellte Rechnungen behalten ihren Stand
  (`customer_snapshot`). Land und USt-IdNr. bestimmen die Steuer und sind nicht änderbar. Eine E-Mail-Adresse,
  unter der schon eine andere Kundin steht, wird abgelehnt. Jede Änderung steht im Audit-Log.
  Achtung: Ein erneuter `thrivecart:history`-Import überschreibt Kontaktdaten übernommener Kundinnen.
- **Thrivecart-Käufe in der Bestellsuche**: Mit Suchbegriff erscheinen unter den Bestellungen auch Treffer
  aus den Altdaten (E-Mail, Produkt, Name, Thrivecart-Bestell- oder Rechnungsnummer).
- **Rechnung erneut senden** (nur Admin, Bestellseite): Rechnung, Stornorechnung oder Rechnung einer
  manuellen Bestellung noch einmal mit PDF, wahlweise an eine andere Adresse. Der Beleg bleibt unverändert,
  der Versand steht im Postausgang.
- **Rate jetzt abbuchen** (nur Admin, Bestellseite): fällige offene oder fehlgeschlagene Rate sofort über
  die gespeicherte Zahlungsart einziehen, auch nach drei Fehlversuchen des täglichen Laufs. Nicht vor
  Fälligkeit, nicht solange ein Einzug unterwegs ist, nicht bei Bestellungen per Rechnung. Der Versuch steht
  mit der klickenden Person im Audit-Log; die Rechnung entsteht wie sonst, wenn der Anbieter bestätigt.
- **Abo pausieren** (nur Admin, Bestellseite, nur Abos): ab einem Tag (frühestens heute) bis einschließlich
  eines Tages oder unbefristet. Fälligkeiten in der Pause werden „erlassen“ (kein Einzug, keine Rechnung;
  Betrag und Termin bleiben stehen), danach läuft das Abo im bestellten Rhythmus weiter. „Pause beenden“
  setzt ab heute fort; eine noch nicht begonnene Pause wird aufgehoben. Pausen werden nie gelöscht
  (`app.subscription_pauses`, Migration 0025), n8n bekommt `abo.pausiert` und `abo.fortgesetzt`.
  Raten- und Anzahlungspläne lassen sich nicht pausieren.

Jede Änderung (Kündigung erledigt, Abo beendet) steht mit der handelnden Person im Audit-Log.

## Erstattung und Storno

- Auf der Bestelldetailseite gibt es je bezahlter Rechnung „Erstatten“ (nur Admin, mit Grund, optional Betrag, und Rückfrage).
  - **Betrag leer**: Der ganze noch offene Betrag wird erstattet. Ist vorher nichts erstattet, entsteht eine Stornorechnung.
  - **Betrag kleiner als offen (Teilerstattung)**: Es entsteht eine **Rechnungskorrektur** über den Teilbetrag, anteilig
    je Position und Steuersatz, mit eigener Nummer im selben Kreis. Die Rate bleibt bezahlt, die Bestellung läuft weiter.
    Weitere Teilerstattungen sind möglich, bis der Rechnungsbetrag erreicht ist; mit der letzten gilt die Rate als storniert.
  - Nach einer Teilerstattung ist keine Stornorechnung mehr möglich, der Rest geht als weitere Korrektur.
    Die Datenbank lässt nie mehr Erstattung oder Korrektur zu als den Rechnungsbetrag (Migration 0028).
- Ablauf:
  1. Die Erstattung wird als „angefordert“ festgehalten (`app.refunds`, Spalte `scope` voll oder teil). Je Rechnung läuft höchstens eine gleichzeitig.
  2. Der Server löst sie beim Anbieter aus (Stripe-Refund oder PayPal-Capture-Refund, bei Teilerstattung mit Betrag). Die Erstattungs-ID ist der Idempotenzschlüssel; ein Doppelklick erstattet nicht doppelt.
  3. Erst nach Bestätigung entstehen Stornorechnung bzw. Rechnungskorrektur, PDF, E-Mail und eine Erstattungsbuchung. Ist die Rechnung damit ganz erstattet, wird die Rate „storniert“; ist nichts Bezahltes mehr übrig, ist die Bestellung „erstattet“.
  4. Lehnt der Anbieter ab, bleibt die Rechnung unverändert und die Erstattung „fehlgeschlagen“. Ein neuer Versuch ist möglich.
- „Offene Raten entfallen lassen“ beendet eine Bestellung: offene Raten werden storniert, ein Abo endet heute. Bereits Bezahltes wird nur über die Erstattung zurückgezahlt.
- Bei einem Widerruf: erst „Offene Raten entfallen lassen“, dann jede bezahlte Rechnung erstatten.

## Mahnwesen (automatisch)

Der tägliche Einzug (`pnpm einzug`, Timer auf dem App-Server) verschickt danach diese E-Mails, jede höchstens einmal
(`app.dunning_notices`, festgeschrieben). Jede enthält einen persönlichen Link zum Kundenbereich (14 Tage gültig),
über den die Kundin die Karte ändert; eine fehlgeschlagene Rate wird nach dem Wechsel gleich abgebucht.

| E-Mail | Wann |
| --- | --- |
| Erinnerung | 7 Tage vor einer automatischen Abbuchung, nur bei Abständen ab 3 Monaten (Quartal, Jahr) |
| Abbuchung fehlgeschlagen | nach jedem abgelehnten Versuch, mit Datum des nächsten Versuchs (nach 3, dann 4 Tagen) |
| Zahlungsart fehlt | Rate fällig, aber keine Karte hinterlegt |
| Letzte Mahnung | nach dem dritten abgelehnten Versuch; danach wird nicht mehr automatisch abgebucht |
| Karte läuft ab | die Karte gilt nicht mehr bis zur nächsten Abbuchung (Ablaufdatum wird bei Stripe gelesen, nur Marke, letzte vier Ziffern, Monat/Jahr) |

Nicht gemahnt werden Bestellungen per Rechnung, übernommene PayPal-Abos (PayPal mahnt selbst), pausierte und beendete
Bestellungen sowie Fehlversuche, die älter als 7 Tage sind. Die Bestellseite zeigt alle verschickten Erinnerungen und
Mahnungen. Bei „fehlgeschlagen“ und „letzte Mahnung“ geht die Meldung `zahlung.fehlgeschlagen` an n8n.
Der Lauf braucht `PUBLIC_BASE_URL` für die Links.

## Abo-Umzug aus Thrivecart

Unter **Abo-Umzug** (Admin, Prüfung) stehen alle Thrivecart-Abos und Ratenpläne, die noch laufen
(aktiv, pausiert, überfällig, Probezeit), aus den Altdaten. Je Abo der Umzugsweg nach Zahlungsanbieter:
PayPal-Abos bleiben bei PayPal (nur die Abrechnung zieht um), Stripe klassisch und ThrivePay liegen im
eigenen Stripe-Konto und ziehen ohne Zutun der Kundin um. Die Übersicht zählt außerdem Ratenpläne mit
höchstens drei offenen Zahlungen (können in Thrivecart auslaufen), Abos ohne Anbieter-ID, ohne
zugeordnetes Produkt und schon übernommene.

### Abo übernehmen (Stripe und ThrivePay, nur Admin)

„Übernehmen“ in der Zeile eines laufenden Abos:

1. liest das Stripe-Abo: Stripe-Kunde, Standardkarte, Ende der laufenden Periode;
2. legt eine Bestellung im neuen System an, die mit der nächsten Zahlung (Periodenende, Berliner Tag)
   beginnt. Betrag und Rhythmus wie in Thrivecart, Steuer nach Produkt und Land wie bei jedem Kauf.
   Ratenplan: die noch offenen Raten werden festgeschrieben. Abo ohne Ende: erste Fälligkeit plus
   festgeschriebene Bedingungen, weitere legt der tägliche Lauf an. Keine Rechnung beim Umzug; die erste
   Rechnung im Kreis IDF-n kommt mit der ersten Zahlung;
3. merkt die Karte für den täglichen Einzug (bei übernommenen Bestellungen schon ab der ersten Rate);
4. kündigt das Stripe-Abo zum Ende der Periode, damit nicht doppelt abgebucht wird. Scheitert das,
   wird nichts angelegt.

Danach in Thrivecart die Abrechnung beenden, ohne das Abo bei Stripe oder PayPal zu kündigen, und in der
Zeile „In Thrivecart beendet“ abhaken. Nicht übernommen werden: pausierte und überfällige Abos, Abos ohne
zugeordnetes Produkt oder ohne bestätigte Steuer, wöchentliche oder unbekannte Rhythmen und Abos, deren
nächste Zahlung heute oder früher ist. Hat die Kundin eine USt-IdNr., muss „USt-IdNr. geprüft“ angehakt
sein (dann Reverse Charge). Jede Übernahme steht in `app.thrivecart_takeovers` (festgeschrieben, nur das
Ende in Thrivecart wird einmal nachgetragen) und im Audit-Log. Meldungen an n8n tragen
`order.thrivecart_takeover`, damit kein neuer Kurszugang entsteht (siehe `docs/webhooks.md`).

### PayPal-Abos übernehmen

„Übernehmen“ bei einem PayPal-Abo liest das Abo bei PayPal (muss aktiv sein und mit dem PayPal-Zugang der
Kasse lesbar) und legt die Bestellung ab der nächsten Abbuchung laut PayPal an. Das Abo bleibt bei PayPal und
bucht weiter selbst ab; die Kasse zieht nie selbst ein. Jede Zahlung wird verbucht, sobald sie bei PayPal
abgeschlossen ist: per PayPal-Meldung (`PAYMENT.SALE.COMPLETED`) und zur Sicherheit im täglichen Lauf
(`pnpm einzug` fragt bei jedem übernommenen Abo mit fälliger Zahlung die Zahlungen ab). Jede Zahlung genau
einmal, auf die älteste offene Fälligkeit (±5 Tage), bei genau passendem Betrag; sonst „prüfen“. Zahlungen
aus der Zeit vor dem Umzug bleiben bei Thrivecart. In Thrivecart danach nur die Abrechnung beenden, nie
„Cancel“ (kündigt das PayPal-Abo mit). Erstattungen und Kündigungen übernommener PayPal-Abos laufen noch
nicht über die Kasse.

## Kundenbereich (für Kundinnen)

Unter `/konto` fordert eine Kundin mit ihrer E-Mail-Adresse einen Link an (höchstens dreimal je Stunde,
bei unbekannter Adresse passiert nichts, die Seite meldet trotzdem dasselbe). Aus der Verwaltung schickt
„Link zum Kundenbereich schicken“ auf der Kundenseite denselben Link. Er gilt 7 Tage; gespeichert wird
nur sein Hash (`app.customer_portal_links`, Migration 0027).

Im Kundenbereich stehen alle Bestellungen zur Adresse mit Zahlplan und Rechnungs-PDFs, Abos und Raten, die
noch über Thrivecart laufen (nur zur Info), und die Links zu Kündigung und Widerruf. Bei Raten und Abos mit
Kartenzahlung gibt es „Karte bzw. Zahlungsart ändern“: neue Zahlungsart per Stripe (SetupIntent, nichts wird
abgebucht), sie gilt ab dann für die Einzüge. Ist eine fällige Rate fehlgeschlagen, wird sie direkt danach
mit der neuen Karte eingezogen (Audit-Log: `kundin:kundenbereich`). PayPal-Abos verwaltet die Kundin in
ihrem PayPal-Konto.

## Buchhaltung (Admin, Prüfung)

Unter **Buchhaltung** wählt man einen Zeitraum (Vorschläge: Vormonat, Quartale, Jahr). Grundlage sind die
ausgestellten Rechnungen nach Rechnungsdatum, mit dem Stand bei Ausstellung; Stornorechnungen zählen
negativ im Zeitraum ihrer Ausstellung. Alt-Rechnungen aus Thrivecart sind nicht enthalten.

- **Steuerbericht** je Land, Steuersatz, Hinweis (steuerfrei, Reverse Charge) und Kundenart. Zeilen mit
  „OSS“ (EU-Ausland, Privatkundin, mit Umsatzsteuer) gehören in die OSS-Meldung beim BZSt.
- **Rechnungsliste (CSV)**: eine Zeile je Rechnungsposition mit Kundin, Land, USt-IdNr., Satz, Netto,
  USt, Brutto, Zahlungsart und Zahlungsreferenz. Semikolon, Dezimalkomma, UTF-8 mit BOM (Excel, DATEV).
- **Steuerbericht (CSV)** und **alle Rechnungs-PDFs (ZIP)**, höchstens 2.000 Rechnungen je ZIP.
