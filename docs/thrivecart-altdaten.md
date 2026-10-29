# Altdaten aus Thrivecart: Kunden, Käufe, Abos, Rechnungen

Stand 29.10.2026. Umgesetzt in Migration 0006 und `packages/db/src/thrivecart-history.ts`.

## Grundsatz

- Alles aus Thrivecart wird 1:1 übernommen: Kunden, Einmalkäufe, Abos und Ratenpläne, alle Zahlungsereignisse und alle Rechnungen.
- Altdaten liegen im Schema `legacy`, getrennt von den neuen Bestellungen und Rechnungen.
- Für Altkäufe entstehen **keine** neuen Rechnungen. Die alten Rechnungen behalten ihre Thrivecart-Nummern; der neue Kreis beginnt bei IDF-1.
- Jede Zeile trägt die Thrivecart-ID und die vollständige Quellzeile (`source_row`).

## Schutz nach GoBD

| Tabelle | Was sich nach dem Import noch ändern darf |
|---|---|
| `legacy.thrivecart_invoices` | nur einmal: Prüfsumme und Ablageort des PDFs |
| `legacy.thrivecart_orders` | Status (z. B. erstattet) und Verknüpfung zu Kunde und Produkt |
| `legacy.thrivecart_events` | nichts |
| `legacy.thrivecart_subscriptions` | der laufende Stand (Zahlungen, nächste Fälligkeit, Status), solange Thrivecart parallel abrechnet |

Löschen ist bei allen verboten. Jede Änderung steht mit altem und neuem Wert im Audit-Log.

## Ablauf

```sh
SOURCE_DATABASE_URL=… infra/db/run-prod.sh db:thrivecart:history --dry-run
SOURCE_DATABASE_URL=… infra/db/run-prod.sh db:thrivecart:history
```

- `SOURCE_DATABASE_URL` ist die Verbindung zum Supabase-Spiegel. Das Programm liest ihn nur, die Sitzung ist auf Nur-Lesen gestellt.
- Kundendaten gehen direkt von Datenbank zu Datenbank und landen in keiner Zwischendatei.
- Der Import ist wiederholbar und kann bis zur Abschaltung von Thrivecart regelmäßig laufen.
- Am Ende meldet er, welche Rechnungsnummern zwischen 1 und der höchsten Nummer fehlen.

## Woher die Daten kommen

| Ziel | Quelle im Spiegel |
|---|---|
| Kunden (`app.customers`, `source = 'thrivecart'`) | `tc_customers`, inkl. Stripe- und HubSpot-ID |
| Einmalkäufe | `tc_purchases` |
| Abos und Ratenpläne | `tc_subscriptions`, inkl. Abo-ID bei Stripe/PayPal für den späteren Umzug |
| Zahlungsereignisse | `tc_events` |
| Rechnungen | eine je Rechnungsnummer aus `tc_purchases` und `tc_subscriptions` |

## Annahmen, die vor dem echten Lauf zu prüfen sind

- Zeitangaben im Spiegel haben keine Zeitzone und werden als UTC gelesen.
- Ausstellende Gesellschaft: bis 22.09.2025 ECB Holding GmbH, ab 23.09.2025 Investiere Dich Frei GmbH. Abgeleitet aus dem Datum, nicht aus dem Beleg.
- Rechnungsbetrag bei Abos und Raten ist die erste Zahlung laut Ereignissen. Netto und Steuer sind dort im Spiegel nicht enthalten.
- Kunden ohne Land bekommen `XX`.

## Stand des Spiegels am 29.10.2026

| | Anzahl |
|---|---|
| Kunden | 6.311 (6.291 verschiedene E-Mail-Adressen) |
| Einmalkäufe | 6.808 |
| Abos und Ratenpläne | 1.092 |
| Zahlungsereignisse | 5.742 |
| Rechnungsnummern | 7.898 von 1 bis 7.979, **81 fehlen im Spiegel** |

## Offen

- **Rechnungs-PDFs:** Thrivecart erzeugt die PDFs selbst; im Spiegel liegen sie nicht. Sie müssen aus Thrivecart geholt, mit Prüfsumme in den WORM-Speicher gelegt und hier nachgetragen werden.
- **81 fehlende Nummern:** in Thrivecart nachsehen (Test- oder Gratisbestellungen?) und dokumentieren.
- **Folgezahlungen ohne eigene Rechnungsnummer:** Thrivecart vergibt eine Nummer je Kauf, nicht je Rate. Mit der Steuerberatung klären, ob das für die Altdaten reicht.
