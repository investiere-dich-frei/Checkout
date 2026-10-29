# Checkout

Stand 29.10.2026. Umgesetzt in `apps/web`.

## Kauflink

`/kaufen/<produkt-slug>/<preisoption-id>?v=<kürzel>`

- `v` ist das Kürzel der Vertriebsperson (`users.sales_code`). Die Bestellung hält fest, über wen sie kam.
- Ein unbekanntes oder deaktiviertes Kürzel verhindert den Kauf nicht; die Bestellung läuft dann ohne Vertrieb.
- Nur Produkte mit bestätigter Steuerkategorie und aktive Preisoptionen sind erreichbar, alles andere ergibt „Seite nicht gefunden“.

## Ablauf

1. Die Seite zeigt Angaben, Preis und Zustimmungen. Der Preis rechnet sich beim Wechsel des Landes neu, mit denselben Funktionen wie die Bestellung.
2. Direkt über dem Button steht der heute fällige Betrag, der Button heißt „Zahlungspflichtig bestellen“ (§ 312j BGB).
3. Pflicht sind Zustimmung zu AGB und Datenschutz sowie die ausdrückliche Zustimmung zum vorzeitigen Beginn (§ 356 Abs. 5 BGB).
4. Rechtstexte und Vertriebsperson bestimmt der Server neu; das Formular kann sie nicht vorgeben.
5. Kunde, Bestellung, Position mit Steuer und alle Fälligkeiten entstehen in einer Transaktion (`placeOrder`), im Audit-Log als `system:checkout`.

## Noch nicht enthalten

- Zahlung über Stripe und PayPal; bis dahin bleibt die Bestellung `offen`.
- Prüfung der USt-IdNr. über VIES; bis dahin gibt es kein Reverse Charge im Checkout.
- Seite „Verträge hier kündigen“ (§ 312k BGB) und Widerrufsbutton.
- Bestätigungsmail.
