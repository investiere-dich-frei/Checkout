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
- **Kauflinks**: alle freigeschalteten Angebote mit dem Kürzel der angemeldeten Person.

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
