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
- **Bestellungen**: Suche nach Name, E-Mail, Produkt oder Bestellnummer; Detailseite mit Zahlplan, Rechnungen (PDF), Kündigungen und Einzugsversuchen.
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

- Auf der Bestelldetailseite gibt es je bezahlter Rechnung „Erstatten und stornieren“ (nur Admin, mit Grund und Rückfrage).
- Ablauf:
  1. Die Erstattung wird als „angefordert“ festgehalten (`app.refunds`).
  2. Der Server löst sie beim Anbieter aus (Stripe-Refund oder PayPal-Capture-Refund). Die Erstattungs-ID ist der Idempotenzschlüssel; ein Doppelklick erstattet nicht doppelt.
  3. Erst nach Bestätigung entstehen Stornorechnung (voller Betrag, umgekehrte Positionen), PDF, E-Mail und eine Erstattungsbuchung. Die Rate wird „storniert“; ist nichts Bezahltes mehr übrig, ist die Bestellung „erstattet“.
  4. Lehnt der Anbieter ab, bleibt die Rechnung unverändert und die Erstattung „fehlgeschlagen“. Ein neuer Versuch ist möglich.
- „Offene Raten entfallen lassen“ beendet eine Bestellung: offene Raten werden storniert, ein Abo endet heute. Bereits Bezahltes wird nur über die Erstattung zurückgezahlt.
- Bei einem Widerruf: erst „Offene Raten entfallen lassen“, dann jede bezahlte Rechnung erstatten.
