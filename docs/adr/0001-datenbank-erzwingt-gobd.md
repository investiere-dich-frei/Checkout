# ADR 0001: Die Datenbank erzwingt die GoBD-Regeln

Status: vorgeschlagen, 29.10.2026

## Kontext

- Rechnungen müssen unveränderbar sein und lückenlos nummeriert werden.
- Jede Änderung an steuerlich relevanten Daten muss nachvollziehbar sein (GoBD, § 146 AO).
- Prüft nur die Anwendung, genügt ein Programmierfehler oder ein direkter Datenbankzugriff, um diese Regeln zu brechen.

## Entscheidung

Die Regeln liegen als Trigger und Constraints in PostgreSQL.

- **Nummernvergabe**:
  - Die Rechnungsnummer vergibt ein Trigger aus `invoice_number_series`.
  - Die Zeilensperre serialisiert parallele Ausstellungen.
  - Ein Rollback nimmt die Nummer mit zurück; so entsteht keine Lücke.
- **Unveränderbarkeit**:
  - `UPDATE`, `DELETE` und `TRUNCATE` auf Rechnungen und Positionen werden abgewiesen.
  - Einzige Ausnahme: Prüfsumme und Speicherort des PDFs werden einmal nachgetragen.
- **Vollständigkeit**:
  - Positionen sind nur in derselben Transaktion erlaubt, in der die Rechnung entsteht.
  - Beim Commit prüft ein Constraint-Trigger, dass die Summen zum Rechnungskopf passen.
- **Audit-Trail**:
  - Jede Änderung an Stamm- und Bewegungsdaten landet in `audit_log`.
  - Jede Zeile trägt den SHA-256-Hash der vorigen Zeile.
  - `audit_verify()` findet Manipulationen, auch solche mit abgeschalteten Triggern.
  - `audit_head()` wird täglich in den WORM-Speicher geschrieben. Damit fällt auch das Abschneiden der letzten Zeilen auf.

## Folgen

- Schreibzugriffe auf das Audit-Log laufen nacheinander. Das ist bei unserem Volumen kein Engpass; 3.840 Bestellungen in mehreren Jahren sind sehr wenig.
- Ein Datenbank-Superuser kann Trigger umgehen. Das verhindert die Datenbank nicht, aber die Hash-Kette deckt es auf. Die Anwendung arbeitet deshalb nie als Superuser.
- Löschpflichten nach DSGVO gelten nicht für Daten mit steuerlicher Aufbewahrungspflicht (Art. 17 Abs. 3 lit. b DSGVO in Verbindung mit § 147 AO). Nach Ablauf der Frist werden diese Daten gesperrt oder anonymisiert. Das Verfahren dafür kommt in Phase 5.
