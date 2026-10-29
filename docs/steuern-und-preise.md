# Preise, Zahlpläne und Umsatzsteuer

Stand 29.10.2026. Umgesetzt in `packages/core`. Vor dem Go-live von der Steuerberatung zu bestätigen.

## Beträge

- Alle Beträge sind ganze Cent, Steuersätze Basispunkte (1900 = 19 %).
- Gerundet wird kaufmännisch, je Position.
- Bei Nettopreisen (aus Thrivecart) kommt die Steuer oben drauf.
- Bei Bruttopreisen bleibt der Bruttobetrag exakt; die Rundung trägt der Nettobetrag.

## Steuerregeln (Version 2026-10-29)

| Käufer | Steuer | Hinweis auf der Rechnung |
|---|---|---|
| Deutschland, Produkt `steuerfrei_4_21` | 0 % | „Die Leistung ist umsatzsteuerfrei nach § 4 Nr. 21 a) bb) UStG.“ |
| Deutschland, sonst | 19 % | – |
| EU-Verbraucher | Normalsatz des Landes (OSS), z. B. AT 20 % | – |
| EU-Unternehmen mit geprüfter USt-IdNr. | 0 % | Reverse Charge |
| Schweiz | 0 %, oder Schweizer MWST, wenn die Gesellschaft dort registriert ist | „Nicht im Inland steuerbare Leistung.“ |
| übrige Länder | 0 % | „Nicht im Inland steuerbare Leistung.“ |

- Die Befreiung nach § 4 Nr. 21 UStG gilt nur für Käufer in Deutschland. So hat es auch Thrivecart gehandhabt: dieselben Produkte kosten in Österreich 20 %.
- Jede Entscheidung trägt eine Regel-ID und die Regelversion. Beides wird mit der Rechnung festgeschrieben.

**Offen:** In Thrivecart wurden Schweizer Bestellungen mit 8,1 % MWST abgerechnet. Die Anforderungen sagen „CH ohne deutsche USt“. Ob die Gesellschaft in der Schweiz registriert ist, klärt die Steuerberatung; bis dahin ist der Schweizer Satz eine Einstellung je Gesellschaft.

## Zahlpläne

- `einmal`: eine Zahlung am Kauftag.
- `raten` und `anzahlung`: erste Zahlung am Kauftag (entfällt bei 0), dann die Folgezahlungen im festen Abstand.
- `abo`: wie Raten, aber ohne Ende.
- Mit Probezeit ist die erste Folgezahlung nach Ablauf der Probezeit fällig, sonst ein Intervall nach dem Kauf.
- Fällt der Tag im Monat weg (31.), gilt der letzte Tag des Monats. Der Stichtag wandert dadurch nicht ab.
- Der Gesamtpreis für die Preisangabe ist die Summe aller Zahlungen. Abos ohne Ende haben keinen.
