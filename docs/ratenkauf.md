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

Eine Prüfung gilt 7 Tage (bei Freigabe ab der Entscheidung) und nur für dieselbe Preisoption und dieselbe E-Mail-Adresse.

## Schalter und Regeln

Verwaltung → Ratenprüfung. Der Schalter „Ratenkauf mit Kredit einschalten“ steht zunächst auf aus. Solange er aus ist, sind Kredit-Preisoptionen ab 20.11.2026 nicht bestellbar. Einschalten erst, wenn RA Dr. Metzner die Texte freigegeben hat.

Regeln (Änderungen gelten nur für neue Prüfungen): Lebenshaltung ohne Wohnen (600 €), Zuschlag je Person (400 €), Anteil des freien Einkommens für grün (50 %), Betrag ab dem das Team immer prüft, Betrag ab dem eine Auskunftei abgefragt werden soll (noch nicht angebunden, solche Fälle werden gelb).

## Rechtstexte

`packages/db/src/credit-texts.ts`, Fassung `CREDIT_TEXTS_VERSION`. Solange sie mit `entwurf` beginnt, sind die Texte Entwürfe zur Prüfung durch RA Dr. Metzner. Jede Bestellung speichert die Fassung (`app.orders.credit_texts_version`); Standardinformation und Ratenvertrag liegen unveränderbar mit Prüfsumme in `app.credit_documents`.

## Mahnungen

Bei Kredit-Bestellungen enthalten Zahlungserinnerungen und letzte Mahnung den Hinweis auf kostenlose Schuldnerberatung (§ 497a BGB). Die Gesamtfälligstellung bleibt an § 498 BGB gebunden und wird nicht automatisch ausgelöst.
