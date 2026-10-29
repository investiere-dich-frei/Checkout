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
