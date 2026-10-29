# Ausgehende Webhooks

Für alles, was nach einem Kauf außerhalb des Checkouts passieren muss, etwa der Kurszugang in LearningSuite oder der Kontakt in HubSpot. Bisher erledigt das n8n über den Thrivecart-Webhook.

## Ereignisse

| Ereignis | Wann |
| --- | --- |
| `zahlung.eingegangen` | jede gebuchte Zahlung (`payment.first` ist bei der ersten Zahlung `true`) |
| `zahlung.erstattet` | Erstattung bestätigt, Stornorechnung erstellt |
| `abo.beendet` | Abo nach Kündigung beendet (`ends_on` = letzter Tag) |
| `bestellung.beendet` | offene Raten entfallen (z. B. Widerruf) |

Jede Meldung enthält die Bestellung mit Kundin (E-Mail, Name, Land, HubSpot-ID), Produkt (mit `thrivecart_product_id`, damit n8n die bestehenden Zuordnungen weiter nutzen kann), Preisoption und Vertriebskürzel.

## Zustellung

- Die Ereignisse entstehen in derselben Transaktion wie ihr Anlass (`app.webhook_outbox`).
- `pnpm db:webhooks:send` stellt sie zu (jede Minute per Timer), per `POST` als JSON an `OUTBOUND_WEBHOOK_URL`.
- Kopfzeilen:
  - `X-IDF-Event`: Ereignis;
  - `X-IDF-Delivery`: eindeutige ID, für doppelte Zustellung;
  - `X-IDF-Timestamp`: Unix-Zeit;
  - `X-IDF-Signature`: `sha256=` + HMAC-SHA256 mit `OUTBOUND_WEBHOOK_SECRET` über `<Timestamp>.<Inhalt>`.
- Der Empfänger soll die Signatur prüfen und Meldungen älter als 5 Minuten ablehnen.
- Antwortet der Empfänger nicht mit 2xx, folgt ein neuer Versuch nach 1, 2, 4 … Minuten, höchstens alle 6 Stunden.
