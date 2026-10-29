# Datensicherung

Zwei voneinander unabhängige Sicherungen, bei zwei Anbietern, an zwei Standorten in Deutschland.

| | Backup A | Backup B |
|---|---|---|
| Anbieter | Hetzner Storage Box | IONOS S3 |
| Standort | Falkenstein (Live-System: Nürnberg) | Frankfurt |
| Schutz | eigener Zugang, nur SFTP | Object Lock im Compliance-Modus, 30 Tage |
| Verschlüsselung | AES-256, eigener Schlüssel | AES-256, eigener Schlüssel |

## Ziele

- **RPO ≤ 5 Minuten**:
  - Das WAL-Archiv wird spätestens alle 60 Sekunden an beide Ziele übertragen.
  - Zusätzlich läuft ein Replikat in Falkenstein.
- **RTO ≤ 4 Stunden**: Neuaufbau aus Terraform und Ansible, dann Wiederherstellung aus A oder B.

## Was gesichert wird

- **Datenbank**: pgBackRest. Vollsicherung sonntags, differenziell täglich, WAL laufend. Konfiguration: `infra/backup/pgbackrest.conf`.
- **Dateien und Konfiguration**: restic, täglich an beide Ziele (`infra/backup/restic-backup.sh`).
- **Kopf der Audit-Kette**: täglich in den WORM-Speicher (`infra/backup/audit-anchor.sh`).

## Prüfung

- **Bei jeder Änderung (CI)**: Generalprobe `infra/backup/probe/run.sh`.
  - Sie baut beide Ziele nach: einen SFTP-Server für A und MinIO mit Object Lock für B.
  - Sie sichert eine Datenbank mit Testrechnungen und legt danach weitere Rechnungen an, die nur im WAL-Archiv stehen.
  - Dann wirft sie den Server weg und stellt aus A und aus B getrennt wieder her.
  - Geprüft wird, dass alle Rechnungen da sind, dass die Nummern keine Lücke haben und dass die Audit-Kette identisch mit dem Original ist.
  - Außerdem muss das Löschen einer gesperrten Sicherungsdatei in B scheitern.
  - Lokal ohne S3: `SFTP_HOST=… SFTP_USER=… SFTP_KEY=… SFTP_PATH=… infra/backup/probe/run.sh` (nur Backup A).

- **Monatlich**: automatischer Wiederherstellungstest (`infra/backup/restore-test.sh`).
  - Er wechselt zwischen A und B ab.
  - Er prüft, dass die Audit-Kette intakt ist, dass die Rechnungsnummern keine Lücke haben und wie aktuell die Daten sind.
  - Das Ergebnis geht an Uptime Kuma; fehlt die Meldung, kommt ein Alarm.
- **Quartalsweise**: Notfallübung mit Neuaufbau auf frischen Servern, protokolliert.

## Offen

- Christian legt die Konten bei Hetzner (Cloud, Storage Box, Object Storage) und IONOS (S3) an.
- Danach werden Zugangsdaten mit SOPS verschlüsselt hinterlegt, und die Platzhalter in `pgbackrest.conf` werden ersetzt.
