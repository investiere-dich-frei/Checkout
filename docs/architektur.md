# Architektur

## Überblick

Das System ist ein modularer Monolith in TypeScript. Ein Repository, ein Deployment, klar getrennte Module.

| Teil | Technik | Ab Phase |
|---|---|---|
| Datenbank, GoBD-Kern | PostgreSQL 17, `packages/db` | 0 |
| Preise, Zahlpläne, Umsatzsteuer | TypeScript, `packages/core` | 1 |
| Backend und API | NestJS, `apps/api` | 1 |
| Checkout und Verwaltung | Next.js, `apps/web` | 1 |
| Hintergrundjobs (Raten, Mahnungen, Webhooks) | Redis und BullMQ | 2 |
| Infrastruktur | Terraform (Hetzner), Ansible | 0 |

## Server

| Server | Standort | Aufgabe |
|---|---|---|
| `app-nbg1` | Hetzner Nürnberg | App, Worker, Monitoring |
| `db-nbg1` | Hetzner Nürnberg | PostgreSQL primär |
| `db-fsn1` | Hetzner Falkenstein | PostgreSQL-Replikat, im Notfall Ersatz |

- Alle Server laufen in Deutschland und sprechen über ein privates Netz miteinander.
- Datenbanken sind von außen nicht erreichbar.

## Grundsatz: Die Datenbank erzwingt die GoBD-Regeln

Unveränderbarkeit, lückenlose Nummern und Audit-Trail sind in PostgreSQL selbst umgesetzt, nicht nur in der Anwendung. Ein Fehler in der Anwendung kann deshalb keine Rechnung ändern und keine Lücke erzeugen. Begründung siehe [ADR 0001](adr/0001-datenbank-erzwingt-gobd.md).

## Datenmodell (Phase 0)

- `companies`: Verkäufergesellschaft. Jede Rechnung gehört genau einer Gesellschaft und läuft in deren Nummernkreis.
- `users`: Nutzer mit Rolle `admin`, `vertrieb`, `freelancer` oder `pruefer`.
- `customers`, `products`, `price_options`: Stammdaten.
  - Preisoptionen beschreiben den ganzen Zahlplan: erste Zahlung, Folgezahlungen, Abstand, Probezeit.
  - Produkte tragen ihre Thrivecart-ID und sind erst nach bestätigter Steuerkategorie verkaufbar, siehe [Thrivecart-Import](thrivecart-import.md).
- `legal_text_versions`: AGB, Datenschutz und Widerruf, versioniert und unveränderbar.
- `orders`, `order_items`:
  - Bestellung mit Verweis auf die zugestimmten Rechtstexte;
  - Vertriebsperson der Bestellung;
  - Zeitpunkt des Widerrufsverzichts.
- `payments`: Zahlungen je Anbieter, eindeutig über die Referenz des Anbieters.
- `invoice_number_series`, `invoices`, `invoice_items`: Rechnungen, siehe [Verfahrensdokumentation](gobd/verfahrensdokumentation.md).
- `audit_log`: Protokoll aller Änderungen an den Tabellen oben, nur anhängend, mit Hash-Kette.
