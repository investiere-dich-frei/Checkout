# IDF Checkout

Eigene Checkout- und Abrechnungsplattform der Investiere Dich Frei GmbH als Ersatz für Thrivecart.

- Hosting ausschließlich in Deutschland (Hetzner), DSGVO-konform
- Doppelte Datensicherung an zwei getrennten Standorten
- GoBD-konforme Rechnungen und lückenloser Nachweis aller Verkäufe

Der Bauplan liegt im Projekt-Dokument „Eigene Thrivecart-Alternative: Funktionsanalyse & Bauplan“.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `packages/db` | Datenmodell, Migrationen und GoBD-Kern mit Tests |
| `infra/terraform` | Server bei Hetzner (Nürnberg und Falkenstein) |
| `infra/ansible` | Einrichtung der Server |
| `infra/backup` | Backup A (Storage Box) und B (IONOS mit Object Lock), Wiederherstellungstest |
| `infra/monitoring` | Prometheus, Grafana, Uptime Kuma |
| `docs` | Anforderungen, Architektur, Datensicherung, Verfahrensdokumentation |

## Lokal starten

```sh
pnpm install
docker compose up -d postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```
