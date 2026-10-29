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

- **Datenbank**: pgBackRest. Vollsicherung sonntags, differenziell täglich, WAL laufend. Konfiguration: `infra/ansible/roles/backup/templates/pgbackrest.conf.j2`, Zeitplan: `zeitplan.cron.j2` daneben.
- **Dateien und Konfiguration**: restic, täglich an beide Ziele (`infra/backup/restic-backup.sh`).
- **Kopf der Audit-Kette**: täglich in den WORM-Speicher (`infra/backup/audit-anchor.sh`).

## Prüfung

- **Bei jeder Änderung (CI)**: Generalprobe `infra/backup/probe/run.sh`.
  - Sie baut beide Ziele nach: einen SFTP-Server für A und ein S3-Gateway mit Object Lock für B.
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

- Backup A (Storage Box) ist eingerichtet. Geheimnisse liegen SOPS-verschlüsselt in
  `infra/ansible/inventories/prod/group_vars/db/secrets.sops.yml`. Den age-Schlüssel dazu hat der Mac mini;
  eine Kopie verwahrt Christian getrennt davon. Ohne diesen Schlüssel sind die Sicherungen nicht lesbar.
- Backup B: Christian legt das IONOS-Konto an. Danach kommen die Zugangsdaten in SOPS, und
  `backup_b_enabled: true` schaltet repo2, restic, den Audit-Anker und den monatlichen Test ein.
