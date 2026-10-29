# Bezahlung über Stripe und PayPal

Die Bestellseite bietet zwei getrennte Zahlungsarten an:

- **Stripe**: Karte und die weiteren Zahlungsarten, die im Stripe-Konto freigeschaltet sind.
- **PayPal**: eigenes PayPal-Konto, direkt angebunden, nicht über Stripe.

Ist für eine Zahlungsart kein Zugang hinterlegt, fehlt sie auf der Seite einfach.

# Stripe

## Ablauf

1. Die Kundin bestellt. Die Bestellung legt alle Fälligkeiten fest (siehe `checkout.md`).
2. Die Bestellseite `/bestellung/<id>` zeigt das Zahlungsfeld von Stripe für die erste fällige Rate.
   - Dafür legt der Server einen Stripe-Kunden und eine Zahlungsabsicht (PaymentIntent) an und merkt sich beide.
   - Lädt die Seite neu, wird dieselbe Zahlungsabsicht wieder verwendet.
   - Bei Raten und Abos wird die Zahlungsart für die folgenden Zahlungen gespeichert (`setup_future_usage`).
3. Stripe meldet die Zahlung an `/api/stripe/webhook`.
   - Erst diese Meldung führt zu Zahlung und Rechnung (IDF-n), nicht die Rückkehr der Kundin auf die Seite.
4. Spätere Raten zieht ein eigener Lauf zum Fälligkeitstag ein. Der kommt mit dem Mahnwesen.

## Schutz vor Fehlbuchungen

- Jede Meldung wird nur mit gültiger Signatur angenommen (`STRIPE_WEBHOOK_SECRET`).
- Jede Meldung liegt mit vollständigem Inhalt und Ergebnis in `app.stripe_events`, unveränderbar.
- Kommt dieselbe Meldung zweimal, entsteht keine zweite Rechnung.
- Gebucht wird nur, wenn die Zahlungsabsicht aus diesem System stammt und Betrag und Währung genau passen.
- Zahlungen aus Thrivecart, die über dasselbe Stripe-Konto laufen, werden ignoriert.
- Passt etwas nicht, wird nichts gebucht. Das Ereignis bekommt das Ergebnis `pruefen`, und das Log meldet die Ereignis-ID.

Offene Fälle finden:

```sql
select id, received_at, payment_intent, outcome_note from app.stripe_events where outcome = 'pruefen' order by received_at;
```

## Einrichtung

Die Schlüssel kommen in die verschlüsselte Datei auf dem Server (SOPS), nie in den Chat oder in den Code:

| Variable | Woher |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe-Dashboard → Entwickler → API-Schlüssel (geheimer Schlüssel) |
| `STRIPE_PUBLISHABLE_KEY` | ebenda (veröffentlichbarer Schlüssel) |
| `STRIPE_WEBHOOK_SECRET` | Stripe-Dashboard → Entwickler → Webhooks → Endpunkt `https://<domain>/api/stripe/webhook`, Ereignis `payment_intent.succeeded` |

- Erst mit Testschlüsseln (`sk_test_…`) arbeiten.
- Ohne Schlüssel zeigt die Bestellseite nur den Zahlplan; der Webhook antwortet mit 503.

# PayPal

## Ablauf

1. Die Kundin klickt auf den PayPal-Knopf. Der Server legt bei PayPal eine Bestellung über die fällige Rate an (`/api/paypal/order`).
   - Betrag und Rate bestimmt immer der Server, nie der Browser.
   - Bei Raten und Abos wird das PayPal-Konto für spätere Einzüge gespeichert (Vault).
2. Sie gibt die Zahlung bei PayPal frei.
3. Der Server zieht das Geld ein (`/api/paypal/capture`) und verbucht die Zahlung mit Rechnung.
4. Zusätzlich meldet PayPal die Zahlung per Webhook (`/api/paypal/webhook`).
   - Das fängt Zahlungen auf, deren direkte Bestätigung verloren ging.
   - Ausstehende Zahlungen (PENDING) werden erst gebucht, wenn PayPal sie abschließt.

## Schutz vor Fehlbuchungen

- Gebucht wird je PayPal-Zahlung (Capture) genau einmal, egal wie oft sie gemeldet wird.
- Gebucht wird nur eine abgeschlossene Zahlung zu einer PayPal-Bestellung aus diesem System, mit genau passendem Betrag und Währung.
- Webhook-Meldungen werden nur nach erfolgreicher Signaturprüfung bei PayPal angenommen.
- Alles liegt unveränderbar in `app.paypal_orders` und `app.paypal_events`; offene Fälle haben das Ergebnis `pruefen`.

```sql
select id, received_at, paypal_order, outcome_note from app.paypal_events where outcome = 'pruefen' order by received_at;
```

## Einrichtung

| Variable | Woher |
| --- | --- |
| `PAYPAL_CLIENT_ID` | PayPal Developer → Apps & Credentials → App |
| `PAYPAL_CLIENT_SECRET` | ebenda |
| `PAYPAL_ENV` | `live` für echte Zahlungen; sonst wird die Sandbox genutzt |
| `PAYPAL_WEBHOOK_ID` | in der App unter Webhooks: Endpunkt `https://<domain>/api/paypal/webhook`, Ereignisse `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED` |

- Erst mit Sandbox-Zugang testen.
- Im Stripe-Konto PayPal als Zahlungsart ausgeschaltet lassen, damit PayPal nicht doppelt erscheint.
