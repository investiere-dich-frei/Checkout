# Betrieb der Checkout-Anwendung

Die Anwendung läuft auf app-nbg1 (Ansible-Rolle `infra/ansible/roles/app`):

- Next.js auf `127.0.0.1:3000`, davor Caddy mit TLS-Zertifikat von Let's Encrypt;
- Zeitgeber: Postausgang und Webhooks jede Minute, Einzug täglich um 6:30 Uhr;
- eigener Nutzer `idf-app`, Zugangsdaten in `/etc/idf/checkout.env` (nur root und `idf-app` lesbar).

## Datenbankzugang

- Die Anwendung arbeitet als `idf_app`: lesen und schreiben, nichts löschen, nie Eigentümerin, Audit-Log nur lesen, Thrivecart-Altdaten nur lesen.
- Die Rolle legt Ansible an (Variable `pg_app_password`), Zugang nur vom App-Server über das private Netz (TLS).
- Die Rechte setzt `infra/db/grants-prod.sh` (packages/db/grants.sql). Nach jeder Migration ausführen.

## Testphase mit idf_test

Testkäufe laufen nie gegen `idf`: Jede verbuchte Zahlung erzeugt dort eine unveränderliche Rechnung
im Kreis `IDF-`, auch mit Stripe-Testschlüsseln oder PayPal-Sandbox. Für die Testphase gibt es die
Datenbank `idf_test` (Ansible legt sie an), ohne Kundendaten und mit eigenem Nummernkreis `TEST-`.
Die Anwendung nutzt sie, solange `checkout_database: idf_test` in `group_vars/app/checkout.yml` steht.

Einrichten, jeweils mit `IDF_DB=idf_test` vor `infra/db/run-prod.sh`:

1. `db:migrate`;
2. `db:company:create` mit denselben Angaben wie in `idf`, Vorsilbe `TEST-`;
3. `db:thrivecart:import` (nur Katalog, **nie** `db:thrivecart:history`);
4. `db:configure users`, `ch-vat 810`, `tax` wie in `idf`;
5. `db:configure payments-mode test --company <id> --actor cli:christian` (nur in `idf_test`, ab Migration 0019);
6. `db:grants`.

Beim Go-live `checkout_database: idf` setzen und auf die Live-Schlüssel umstellen.

## Reihenfolge bis zum ersten Verkauf

1. PR freigeben, dann `infra/db/migrate-prod.sh` (Migrationen ab 0008).
2. In `infra/ansible/inventories/prod/group_vars/app/secrets.sops.yml` und `.../db/secrets.sops.yml` ergänzen:
   - `pg_app_password` (in beiden, gleicher Wert);
   - `stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`;
   - `paypal_client_id`, `paypal_client_secret`, `paypal_webhook_id`, optional `paypal_env: live`;
   - `outbound_webhook_url`, `outbound_webhook_secret` (n8n);
   - die Graph-Zugangsdaten gibt es schon (Alarm-Mails).
   - Absender der Kunden-E-Mails ist `buchhaltung@investieredichfrei.de` (`checkout_mail_from`, Entscheidung Christian 30.10.2026). Die Entra-App darf bisher nur als service@ senden: Postfach buchhaltung@ in den Exchange-Bereich „IDF Ueberwachung - nur service@“ aufnehmen (RBAC für Anwendungen), sonst lehnt Graph das Senden ab.
3. DNS: `buchhaltung.investieredichfrei.de` als A-Eintrag auf 2.31.89.112.
4. `checkout_ready: true` in `group_vars/app/checkout.yml`, dann `ansible-playbook site.yml`.
5. `infra/db/grants-prod.sh`.
6. Stripe: Webhook-Endpunkt `https://buchhaltung.investieredichfrei.de/api/stripe/webhook` für `payment_intent.succeeded`.
7. PayPal: Webhook `https://buchhaltung.investieredichfrei.de/api/paypal/webhook` für `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`.
8. Rechtstexte (AGB, Datenschutz, Widerrufsbelehrung) als Fassungen in `app.legal_text_versions` einspielen.
9. Admin-Zugänge anlegen (Christian, Emilia, Julia; Liste in `infra/db/setup/admins.json`):
   `infra/db/run-prod.sh db:configure users $PWD/infra/db/setup/admins.json --actor cli:christian`.
   Vertrieb kommt später mit Rolle `vertrieb` und `sales_code` in eine eigene Datei.
10. Steuer wie in Thrivecart:
    - Schweiz 8,1 %: `infra/db/run-prod.sh db:configure ch-vat 810 --company <id> --actor cli:christian`.
      Österreich nimmt den EU-Satz 20 % ohne eigene Einstellung.
    - Steuerkategorie je Produkt bestätigen und Live-Produkte freischalten:
      `infra/db/run-prod.sh db:configure tax $PWD/infra/db/setup/steuer-je-produkt.json --by ChristianBolda@investieredichfrei.de`.
      Die Datei übernimmt Thrivecart 1:1: zuerst die abgelesene Produkteinstellung („Calculate sales tax?“),
      sonst die Steuertabelle je Produkt, sonst die letzte bezahlte DE-Bestellung seit 01.12.2025.
      `amount_basis` übernimmt die Preisart: „Include in price“ = brutto, „Add to price“ = netto. Sie gilt für
      alle Preisoptionen des Produkts. Produkte ohne Beleg (Liste `ohne_beleg`) bleiben gesperrt.
      Bereits bestätigte Produkte ändert ein zweiter Lauf nicht, auch nicht ihre Preisart.
    - Alle drei Befehle zuerst mit `--dry-run`.
11. Testkauf mit Stripe-Testkarte und PayPal-Sandbox, dann auf Live-Schlüssel umstellen.
