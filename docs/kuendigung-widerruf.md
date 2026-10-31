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

## Sofortstart

- Die Checkbox im Checkout ist freiwillig (§ 357a Abs. 2 BGB, Schreiben RA Dr. Metzner, Az. 385/26). Wortlaut nach Entscheidung Christian vom 28.10.2026, gleich wie im Thrivecart-Checkout, in `packages/db/src/legal.ts`.
- Mit Häkchen: `app.orders.withdrawal_waiver_at` ist gesetzt, Zugang sofort. Ohne Häkchen: Kauf trotzdem möglich, Zugang am Tag nach Ablauf der Widerrufsfrist (Kauftag + 15 Tage).
- Die Bestellbestätigung nennt den erklärten Text oder den Starttermin; die Webhooks an n8n tragen `sofortstart_at` und `access_from`.
- Ausnahme wie in Thrivecart (SOP CS-009, n8n-Ablauf „ThriveCart Webhook“): Produkte mit `app.products.immediate_access` (Masterclass Essential, Thrivecart 166) zeigen kein Häkchen; der Zugang beginnt am Kauftag (Migration 0018).

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
- `PUBLIC_BASE_URL` setzt die Adresse für Links in E-Mails (z. B. `https://buchhaltung.investieredichfrei.de`).

## USt-IdNr.-Prüfung (VIES)

- Gibt ein Unternehmen aus einem anderen EU-Land eine USt-IdNr. an, prüft der Checkout sie beim VIES-System der EU.
- Gültig: Reverse Charge, ohne Umsatzsteuer. Die Abfrage steht mit Abfragenummer in `app.vat_id_checks`.
- Ungültig: Hinweis im Formular; ohne USt-IdNr. wird Umsatzsteuer berechnet.
- VIES nicht erreichbar: Bestellung mit Umsatzsteuer, die Abfrage wird trotzdem festgehalten.

## Rechnung als PDF

- Das PDF entsteht in derselben Transaktion wie die Rechnung, aus den Schnappschüssen von Kundin und Gesellschaft.
- Es liegt unveränderbar in `app.invoice_documents`. Die Rechnung verweist mit SHA-256 und `pdf_storage_key = db:<id>` darauf.
- Dieselbe Rechnung ergibt Byte für Byte dasselbe PDF (feste Metadaten).
- Die Rechnungsmail hängt genau dieses PDF an. Ohne PDF wird die Mail nicht verschickt, sondern später erneut versucht.
- Auf der Bestellseite steht je bezahlter Rate ein Link zum Herunterladen.
- Sobald der WORM-Speicher (IONOS, Backup B) bereitsteht, werden die PDFs zusätzlich dorthin kopiert.
