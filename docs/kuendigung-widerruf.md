# Kündigung, Widerruf und Postausgang

## Kündigungsbutton (§ 312k BGB)

- Jede Seite verlinkt im Fuß „Verträge hier kündigen“ auf `/vertraege-kuendigen`. Eine Anmeldung ist nicht nötig.
- Die Bestätigungsseite fragt ab:
  - Art der Kündigung: ordentlich oder außerordentlich (dann mit Grund);
  - Name und E-Mail-Adresse;
  - den Vertrag (Bestell-, Rechnungsnummer oder Produkt);
  - das gewünschte Vertragsende: nächstmöglicher Zeitpunkt oder ein Datum.
- Der Knopf heißt „Jetzt kündigen“.
- Danach zeigt die Seite die Eingangsbestätigung mit Datum und Uhrzeit des Eingangs. Sie lässt sich drucken oder als PDF speichern.
- Dieselbe Bestätigung geht sofort per E-Mail raus.

## Widerrufsbutton (§ 356a BGB)

- Im Fuß jeder Seite: „Vertrag widerrufen“ auf `/vertrag-widerrufen`.
- Abgefragt werden Name, E-Mail-Adresse und Vertrag. Der Knopf heißt „Widerruf bestätigen“.
- Eingangsbestätigung wie bei der Kündigung.

## Nachweis

- Jede Erklärung liegt mit allen Angaben und dem Eingangszeitpunkt in `app.contract_notices`, unveränderbar.
- Die Erklärung wird einem Vertrag zugeordnet, wenn Nummer **und** E-Mail-Adresse passen:
  - neue Bestellung (Bestellnummer oder Rechnungsnummer IDF-n);
  - Kauf aus Thrivecart (Bestell- oder Rechnungsnummer).
- Ohne Zuordnung bleibt die Erklärung trotzdem gültig und wird von Hand geklärt:

```sql
select received_at, kind, full_name, contract_reference from app.contract_notices
 where order_id is null and thrivecart_order_id is null order by received_at;
```

- Das Beenden des Vertrags selbst (Abo stoppen, Raten stornieren) folgt mit dem Mahnwesen und der Abo-Verwaltung.

## Postausgang

- Alle E-Mails an Kundinnen entstehen zuerst in `app.mail_outbox`, in derselben Transaktion wie ihr Anlass.
- Der Lauf `pnpm db:mail:send` verschickt sie über Microsoft Graph. Er soll jede Minute laufen.
  - Bei einem Fehler folgt ein neuer Versuch nach 1, 2, 4 … Minuten, höchstens stündlich.
  - Gesendete E-Mails liegen zusätzlich im Ordner „Gesendet“ des Absender-Postfachs.
- Umgebung: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` (dieselbe Entra-App wie die Alarm-Mails) und `MAIL_FROM`.

## Bestellbestätigung und Rechnungsmail

- Mit jeder Bestellung geht eine Bestätigung in den Postausgang, in derselben Transaktion:
  - Leistung, Gesamtbetrag, Steuerhinweis und Zahlplan;
  - Link zur Bestellseite zum Bezahlen;
  - Bestätigung des vorzeitigen Leistungsbeginns (§ 356 Abs. 5 BGB), falls erklärt;
  - Widerrufsbelehrung und AGB im Wortlaut der zugestimmten Fassung (dauerhafter Datenträger, § 312f BGB).
- Mit jeder gebuchten Zahlung geht die Rechnung per E-Mail raus, genau einmal. Das PDF hängt sich an, sobald es erzeugt ist.
- `PUBLIC_BASE_URL` setzt die Adresse für Links in E-Mails (z. B. `https://kasse.investieredichfrei.de`).

## USt-IdNr.-Prüfung (VIES)

- Gibt ein Unternehmen aus einem anderen EU-Land eine USt-IdNr. an, prüft der Checkout sie beim VIES-System der EU.
- Gültig: Reverse Charge, ohne Umsatzsteuer. Die Abfrage steht mit Abfragenummer in `app.vat_id_checks`.
- Ungültig: Hinweis im Formular; ohne USt-IdNr. wird Umsatzsteuer berechnet.
- VIES nicht erreichbar: Bestellung mit Umsatzsteuer, die Abfrage wird trotzdem festgehalten.
