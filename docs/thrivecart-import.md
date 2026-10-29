# Produkte aus Thrivecart übernehmen

Stand 29.10.2026. Die Produkte und Preisoptionen werden 1:1 aus Thrivecart übernommen, damit Thrivecart und das neue System eine Zeit lang dieselben Angebote führen.

## Ablauf

0. **Gesellschaft anlegen**, falls noch nicht geschehen:
   ```sh
   DATABASE_URL=… pnpm --filter @idf/db company:create gesellschaft.json --actor cli:<name> [--dry-run]
   ```
   Legt die Gesellschaft und ihren Rechnungsnummernkreis in einer Transaktion an. Die JSON-Datei liegt nicht im Repository.
1. **Export** aus dem Supabase-Spiegel der Thrivecart-Daten, nur lesend:
   [`packages/db/thrivecart/export-katalog.sql`](../packages/db/thrivecart/export-katalog.sql).
   Ergebnis ist eine JSON-Datei. Sie enthält keine Kundendaten und liegt nicht im Repository, sondern in der Projektablage.
2. **Probelauf** gegen die Datenbank, ohne zu speichern:
   ```sh
   DATABASE_URL=… pnpm --filter @idf/db thrivecart:import katalog.json --company <id> --dry-run
   ```
3. **Import** ohne `--dry-run`. Das Audit-Log vermerkt `system:thrivecart-import` als handelnde Stelle.

Der Import ist wiederholbar. Er erkennt Produkte und Preisoptionen an ihrer Thrivecart-ID und schreibt nur Änderungen. Eine Option, die Thrivecart nicht mehr anbietet, wird abgeschaltet und nicht gelöscht.

## Was der Import nicht tut

- Er schaltet kein Produkt zum Verkauf frei. Jedes übernommene Produkt ist zunächst inaktiv.
- Er bestätigt keine Steuerkategorie und überschreibt keine bestätigte.

## Zahlpläne

| Thrivecart | Neues System |
|---|---|
| Einmalzahlung (`single`) | `einmal` |
| Abo ohne Ende (`rebills` = 0) | `abo` |
| Gleich hohe Zahlungen, auch nach Probezeit ohne erste Zahlung | `raten` |
| Erste Zahlung weicht von den Folgezahlungen ab | `anzahlung` |

- Thrivecart zählt mit `rebills` die Folgezahlungen nach der ersten.
- Abstände: monatlich, alle 3 Monate, jährlich.
- Thrivecart führt Preise ohne Steuer. Sie werden deshalb als `netto` übernommen.

## Steuerkategorie

- Quelle sind die Steuersätze, die Thrivecart bei Bestellungen aus Deutschland tatsächlich angewendet hat (Tabelle `manual_order_tax` im Spiegel).
- Satz 0 mit Hinweis auf § 4 Nr. 21 UStG ergibt `steuerfrei_4_21`.
- Ohne Angabe gilt vorläufig `standard`, also mit Umsatzsteuer. Das ist die vorsichtige Seite.

## Stand des Exports vom 29.10.2026

| | Anzahl |
|---|---|
| Produkte | 169 |
| davon live in Thrivecart | 126 |
| live mit bekannten Preisoptionen | 67 |
| Preisoptionen | 86 (60 Einmal, 13 Raten, 12 Abo, 1 Anzahlung) |
| Produkte mit Steuerangabe aus Bestellungen | 20 |

Lücken, die vor dem Verkauf geschlossen werden müssen:

- 59 Live-Produkte haben im Spiegel keine Preisoptionen. Sie kommen aus dem Thrivecart-Konto selbst nach.
- Bei 47 Produkten mit Preisoptionen fehlt die Steuerangabe. Sie bleiben bis zur Bestätigung bei `standard`.
- Die Preise in der Statistik von 603 Preisoptionen sind alle jemals verkauften Varianten. Übernommen werden nur die, die der Checkout heute anbietet.
