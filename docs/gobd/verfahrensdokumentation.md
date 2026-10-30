# Verfahrensdokumentation (Gerüst)

Dieses Dokument wächst mit jeder Phase. Vor dem Livegang prüft es die Steuerberatung.

## 1 Allgemeine Beschreibung

- Unternehmen: Investiere Dich Frei GmbH
- System: IDF Checkout, Verkauf digitaler Programme und Coachings
- Verantwortlich: Christian (Geschäftsführung)

## 2 Anwenderdokumentation

Folgt in Phase 1: Bedienung von Checkout, Verwaltung und Kauflinks.

## 3 Technische Systemdokumentation

### 3.1 Belegkette

Bestellung → Zahlung → Rechnung → Auszahlung des Zahlungsanbieters.

- Jede Stufe verweist auf die vorige: `invoices.order_id`, `payments.order_id`.
- Die Auszahlung folgt mit dem Abgleich in Phase 4.

### 3.2 Rechnungsnummern

- Jede Gesellschaft hat einen eigenen Nummernkreis.
- Der Kreis der IDF GmbH beginnt bei IDF-1. Die Vorsilbe „IDF-“ trennt ihn von den Thrivecart-Nummern,
  die im Parallelbetrieb weiterlaufen (Entscheidung Christian, 29.10.2026). Die Vorsilbe ist danach nicht mehr änderbar.
- Die Steuerberatung bestätigt den eigenen Kreis vor dem ersten Verkauf.
- Alte Thrivecart-Rechnungen bleiben mit ihren Originalnummern im Archiv (`legacy.thrivecart_invoices`), getrennt vom neuen Kreis.
- Die Nummer vergibt ausschließlich die Datenbank.

### 3.3 Unveränderbarkeit und Korrektur

- Eine ausgestellte Rechnung wird nie geändert und nie gelöscht.
- Fehler werden durch eine Stornorechnung über den vollen Betrag korrigiert, danach folgt eine neue Rechnung.
- Je Rechnung ist höchstens ein Storno möglich.

### 3.4 Steuerangaben

- Der Steuersatz wird je Position als Wert festgeschrieben.
- Eine Steuerbefreiung braucht einen Hinweistext auf der Position, z. B. „Steuerfrei nach § 4 Nr. 21 UStG“.
- Jedes Produkt hat eine Steuerkategorie mit Herkunft (`tax_source`).
- Verkaufbar ist ein Produkt erst, wenn ein Admin die Steuerkategorie bestätigt hat (`tax_confirmed_at`, `tax_confirmed_by`). Die Datenbank erzwingt das.
- Der Import aus Thrivecart übernimmt die Kategorie nur als Vorschlag und bestätigt nie selbst, siehe [Thrivecart-Import](../thrivecart-import.md).

### 3.5 Protokollierung

- Jede Änderung wird mit Zeitpunkt, handelnder Person, altem und neuem Stand protokolliert.
- Das Protokoll ist durch eine Hash-Kette gesichert, siehe [ADR 0001](../adr/0001-datenbank-erzwingt-gobd.md).

## 4 Betriebsdokumentation

### 4.1 Datensicherung

Zwei unabhängige Sicherungen an getrennten Standorten, siehe [Datensicherung](../datensicherung.md).

### 4.2 Aufbewahrung

- Rechnungen und Buchungsbelege: 8 Jahre (§ 147 AO in der Fassung ab 2025). Die WORM-Sperre ist mit 10 Jahren bewusst länger gewählt.
- Rechnungs-PDFs liegen im WORM-Speicher (Object Lock, Compliance-Modus).

## 5 Internes Kontrollsystem

- Rollen und Rechte: Admin, Vertrieb, Freelancer, Prüfer.
- Der monatliche Wiederherstellungstest prüft:
  - dass die Audit-Kette intakt ist;
  - dass die Rechnungsnummern keine Lücke haben.
