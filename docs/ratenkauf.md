# Ratenkauf als Verbraucherkredit (CCD2)

Ab 20.11.2026 gilt in Deutschland die neue Verbraucherkreditrichtlinie (RL (EU) 2023/2225, Umsetzungsgesetz BGBl. 2026 I Nr. 139). Ratenzahlungen, die länger als 50 Tage nach Lieferung laufen, sind dann auch ohne Zinsen ein Kredit (§ 506 BGB n. F.). Für Verträge vor dem 20.11.2026 gilt das alte Recht (Art. 229 § 71 EGBGB).

Ausführlicher Plan, Rechtsgrundlagen und Entscheidungen: Projektordner `checkout/ccd2/`.

## Wann ist eine Bestellung ein Kredit?

`classifyCredit` in `packages/core/src/credit.ts`:

- nur Privatkundinnen, nur Ratenpläne (Einmalzahlung und unbefristete Abos nie),
- Kauftag ab 20.11.2026,
- letzte Rate mehr als 50 Tage nach dem Kauftag **oder** Aufschlag gegenüber dem Einmalpreis.

Pläne mit Aufschlag („Zinsen“) verkauft die Kasse nicht als Kredit, weil dann effektiver Jahreszins, Sollzins und volle Standardinformation nötig wären. Sie sind gesperrt, bis sie abgeschafft oder richtig umgebaut sind. Die Produktverwaltung zeigt je Preisoption, ob sie ein Kredit ist.

## Klickstrecke

1. Kaufseite: Kundin wählt Raten, gibt Daten ein und beantwortet sechs Fragen zur Kreditwürdigkeit (Beschäftigung, Netto-Einkommen, Wohnkosten, andere Raten, mitversorgte Personen, Zahlungsprobleme). Warnhinweis „Achtung! Kreditaufnahme kostet Geld.“ steht beim Preis.
2. Prüfung (`assessQuestionnaire`): **grün**, **gelb** oder **rot**. Jede Prüfung ist mit Regeln und Antworten festgeschrieben (`app.credit_checks`).
3. Grün: Die Europäische Standardinformation geht per E-Mail raus und steht auf `/kaufen/…/raten/<prüfung>`. Gelb: Das Team entscheidet unter Verwaltung → Ratenprüfung; bei Freigabe bekommt die Kundin Standardinformation und Link. Rot: Ablehnung sofort per E-Mail mit Hinweis auf Schuldnerberatung und auf Prüfung durch einen Menschen.
4. Vertragsseite: Standardinformation lesen, drei Kästchen ohne Vorauswahl (AGB, Ratenvertrag, freiwillig Wertersatz), „Zahlungspflichtig bestellen“.
5. Danach: Bestellbestätigung, Ratenvertrag mit Widerrufsinformation per E-Mail, Erinnerung an das Widerrufsrecht zwei Tage später (Art. 247 § 2 Abs. 4 EGBGB).

Wiederholte Anfragen: Die Selbstauskunft ließe sich mit anderen Zahlen wiederholen, bis sie grün ergibt. Deshalb wird grün zu gelb (Team entscheidet), wenn dieselbe E-Mail-Adresse für dasselbe Produkt in den letzten 30 Tagen schon abgelehnt wurde oder schon zwei Anfragen gestellt hat (Verfahren `fragebogen-2`).

Nachweise nach der Gegenprüfung vom 11.11.2026 (Migration 0036):

- Bestellt wird nur auf die Standardinformation, die angezeigt war (Prüfsumme). Sie wird im Wortlaut mit der Bestellung festgeschrieben (`standardinformation_bestellung`) und mit dem Ratenvertrag gemailt.
- Ratenverträge haben eine lesbare Nummer `RV-n` (eigener Zähler, kein Rechnungskreis).
- Ratenvertrag und Widerrufserinnerung haben eigene Mail-Zwecke (`ratenvertrag`, `ratenkauf_erinnerung`). Der Versandzeitpunkt der Vertrags-Mail ist der Beginn der Widerrufsfrist und steht in der Bestellansicht.
- Die Erinnerung entfällt, wenn die Bestellung vorher widerrufen oder storniert wurde (`cancelled_at`, Grund; Inhalt bleibt unverändert).
- Der Fragebogen verlangt die Bestätigung, mindestens 18 Jahre alt zu sein.
- Unternehmen kaufen solche Raten ohne Prüfung, aber nur mit geprüfter USt-IdNr. oder mit der Bestätigung, für ihre gewerbliche oder selbständige Tätigkeit zu kaufen (`orders.business_purpose_confirmed_at`).

Eine Prüfung gilt 7 Tage (bei Freigabe ab der Entscheidung) und nur für dieselbe Preisoption und dieselbe E-Mail-Adresse.

## Sofortzugang, Länder und Löschen (Entscheidungen Christian vom 11.11.2026)

- **Sofortzugang:** Bei Ratenkauf mit Kredit gibt es den Zugang nur mit Zustimmung zum Wertersatz sofort, sonst am Tag nach Ablauf der 14 Tage. Das gilt auch für Produkte mit `immediate_access`; sonst ließe sich der Kurs 14 Tage nutzen und ohne Wertersatz widerrufen.
- **Länder:** Ratenkredit nur bei Anschrift in den eingestellten Ländern (`credit_settings.credit_countries`, zunächst nur DE). Österreich hat ein eigenes Verbraucherkreditgesetz ab 20.11.2026; die Schweiz nimmt zinsfreie Raten voraussichtlich aus (Art. 7 KKG). Beides erst nach Bestätigung durch den Anwalt freischalten.
- **Löschen:** Der tägliche Einzug schwärzt Fragebogen-Antworten, Kundenangaben und E-Mail-Adresse einer Prüfung (`redactExpiredCreditChecks`): ohne Bestellung nach 6 Monaten, mit Ratenvertrag 3 Jahre nach der letzten Rate. Ergebnis, Regeln, Beträge und Begründungen bleiben als Nachweis (§ 505b Abs. 4 BGB n. F.). Die Datenbank erlaubt nur diesen Übergang (Migration 0037); das Audit-Log speichert die Antworten seit 0037 nicht mehr.

## Schalter und Regeln

Verwaltung → Ratenprüfung. Der Schalter „Ratenkauf mit Kredit einschalten“ steht zunächst auf aus. Solange er aus ist, sind Kredit-Preisoptionen ab 20.11.2026 nicht bestellbar. Einschalten erst, wenn der Anwalt die Texte freigegeben hat.

Regeln (Änderungen gelten nur für neue Prüfungen): Lebenshaltung ohne Wohnen (600 €), Zuschlag je Person (400 €), Anteil des freien Einkommens für grün (50 %), Betrag ab dem das Team immer prüft, Betrag ab dem eine Auskunftei abgefragt werden soll (noch nicht angebunden, solche Fälle werden gelb).

## Rechtstexte

`packages/db/src/credit-texts.ts`, Fassung `CREDIT_TEXTS_VERSION`. Solange sie mit `entwurf` beginnt, sind die Texte Entwürfe zur Prüfung durch einen Anwalt. Jede Bestellung speichert die Fassung (`app.orders.credit_texts_version`); Standardinformation und Ratenvertrag liegen unveränderbar mit Prüfsumme in `app.credit_documents`.

## Mahnungen

Verzugszinsen und Mahngebühren berechnen wir bei Ratenkäufen nicht (Entscheidung Christian vom 11.11.2026); die Texte sagen das ausdrücklich.


Bei Kredit-Bestellungen enthalten Zahlungserinnerungen und letzte Mahnung den Hinweis auf kostenlose Schuldnerberatung (§ 497a BGB). Die Gesamtfälligstellung bleibt an § 498 BGB gebunden und wird nicht automatisch ausgelöst.
