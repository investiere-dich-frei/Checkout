# Ausgehende Webhooks

Für alles, was nach einem Kauf außerhalb des Checkouts passieren muss, etwa der Kurszugang in LearningSuite oder der Kontakt in HubSpot. Bisher erledigt das n8n über den Thrivecart-Webhook.

## Ereignisse

| Ereignis | Wann |
| --- | --- |
| `zahlung.eingegangen` | jede gebuchte Zahlung (`payment.first` ist bei der ersten Zahlung `true`) |
| `zahlung.erstattet` | Erstattung bestätigt, Stornorechnung erstellt |
| `abo.beendet` | Abo nach Kündigung beendet (`ends_on` = letzter Tag) |
| `abo.pausiert` | Abo pausiert (`starts_on`, `ends_on`; `ends_on` leer = unbefristet) |
| `abo.fortgesetzt` | Pause beendet, Abo läuft ab `resumed_on` weiter |
| `bestellung.beendet` | offene Raten entfallen (z. B. Widerruf) |

Jede Meldung enthält die Bestellung mit Kundin (E-Mail, Name, Anschrift, Land, HubSpot-ID), Produkt (mit `thrivecart_product_id`, damit n8n die bestehenden Zuordnungen weiter nutzen kann), Preisoption (mit Art und Abstand der Zahlungen) und Vertriebskürzel. Empfänger ist der n8n-Ablauf „IDF Checkout Meldungen“; er übersetzt die Meldung in die Felder des Thrivecart-Webhooks und nutzt dieselben Zuordnungen (`tc_products`).

Für den Kurszugang trägt die Bestellung außerdem (Widerruf und Sofortstart, SOP CS-009):

- `sofortstart_at`: Zeitpunkt, zu dem die Kundin den Sofortstart verlangt hat, sonst `null`;
- `access_from`: Tag, ab dem der Zugang freigeschaltet wird (`YYYY-MM-DD`). Mit Sofortstart oder bei Produkten mit Sofortzugang (Masterclass Essential, Thrivecart 166) der Kauftag, sonst Kauftag + 15 Tage. n8n schaltet frühestens an diesem Tag frei, wie beim Thrivecart-Kauf ohne Häkchen.

Aus Thrivecart übernommene Abos (Abo-Umzug) tragen `order.thrivecart_takeover` mit `subscription_id`, `route` (`paypal`, `stripe`, `thrivepay`), `remote_subscription_id` und `first_due_on`, sonst `null`. Die Kundin hat ihren Zugang schon aus dem Thrivecart-Kauf. n8n legt für solche Bestellungen keinen neuen Zugang an und schickt keine Willkommensmail, verbucht die Zahlung aber wie gewohnt (HubSpot).

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
