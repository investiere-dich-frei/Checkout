# Betrieb der Checkout-Anwendung

Die Anwendung läuft auf app-nbg1 (Ansible-Rolle `infra/ansible/roles/app`):

- Next.js auf `127.0.0.1:3000`, davor Caddy mit TLS-Zertifikat von Let's Encrypt;
- Zeitgeber: Postausgang und Webhooks jede Minute, Einzug täglich um 6:30 Uhr;
- eigener Nutzer `idf-app`, Zugangsdaten in `/etc/idf/checkout.env` (nur root und `idf-app` lesbar).

## Datenbankzugang

- Die Anwendung arbeitet als `idf_app`: lesen und schreiben, nichts löschen, nie Eigentümerin, Audit-Log nur lesen, Thrivecart-Altdaten nur lesen.
- Die Rolle legt Ansible an (Variable `pg_app_password`), Zugang nur vom App-Server über das private Netz (TLS).
- Die Rechte setzt `infra/db/grants-prod.sh` (packages/db/grants.sql). Nach jeder Migration ausführen.

## Reihenfolge bis zum ersten Verkauf

1. PR freigeben, dann `infra/db/migrate-prod.sh` (Migrationen ab 0008).
2. In `infra/ansible/inventories/prod/group_vars/app/secrets.sops.yml` und `.../db/secrets.sops.yml` ergänzen:
   - `pg_app_password` (in beiden, gleicher Wert);
   - `stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`;
   - `paypal_client_id`, `paypal_client_secret`, `paypal_webhook_id`, optional `paypal_env: live`;
   - `outbound_webhook_url`, `outbound_webhook_secret` (n8n);
   - die Graph-Zugangsdaten gibt es schon (Alarm-Mails).
3. DNS: `kasse.investieredichfrei.de` als A-Eintrag auf 2.31.89.112.
4. `checkout_ready: true` in `group_vars/app/checkout.yml`, dann `ansible-playbook site.yml`.
5. `infra/db/grants-prod.sh`.
6. Stripe: Webhook-Endpunkt `https://kasse.investieredichfrei.de/api/stripe/webhook` für `payment_intent.succeeded`.
7. PayPal: Webhook `https://kasse.investieredichfrei.de/api/paypal/webhook` für `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`.
8. Rechtstexte (AGB, Datenschutz, Widerrufsbelehrung) als Fassungen in `app.legal_text_versions` einspielen.
9. Admin-Zugang: Nutzer in `app.users` anlegen (Rolle `admin`, Vertrieb mit `sales_code`).
10. Steuerkategorie je Produkt bestätigen und Produkte freischalten.
11. Testkauf mit Stripe-Testkarte und PayPal-Sandbox, dann auf Live-Schlüssel umstellen.
