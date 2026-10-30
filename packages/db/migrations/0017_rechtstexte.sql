-- 0017 Rechtstexte für den neuen Checkout, 1:1 übernommen (Auftrag Christian, 30.10.2026).
--
-- Quellen:
-- - AGB: Website investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen,
--   Webflow-CMS „Rechtliches“, Eintrag 68b8455ca92402c16594e09b, veröffentlicht 28.10.2026,
--   „Stand: Oktober 2026“. SHA-256 des Quell-HTML: ef14f05346fc44c57b242bdf77b38e677247cf0ceeca47a72bfff75c31eb4253
-- - Datenschutz: investieredichfrei.de/rechtliches/datenschutzerklaerung, Webflow-Eintrag
--   68b8454f05284fff6c11e9f8, veröffentlicht 16.02.2026, „Stand: 09.08.2025“.
--   SHA-256 des Quell-HTML: 812acf7f8bcb58b89f437c14372d0b61bc7c25bf24d47b19641c4ddc4e982409
-- - Widerrufsbelehrung: Fassung 3.1 von RA Dr. Metzner (Az. 385/26, 26.10.2026), wie sie seit
--   28.10.2026 in den Rechnungsmails steht (Supabase manual_order_settings.widerruf_html,
--   MD5 des Klartexts 9581c0011f9adf4acac06bbbc6cab63a). Die Seite „Widerrufsbelehrungen“ der
--   Website zeigt noch die ältere Fassung ohne Wertersatz für Dienstleistungen.
--
-- HTML wurde nur in Klartext umgewandelt (Absätze, Listenpunkte, Zeilenumbrüche); der Wortlaut
-- ist unverändert. Fassungen sind unveränderbar; neue Texte kommen als neue Zeilen.

insert into app.legal_text_versions (kind, version, content, valid_from) values
  ('agb', 'Stand Oktober 2026', $rechtstext$AGB

1. Präambel

Die Investiere Dich Frei GmbH (im Folgenden „IDF“) bietet verschiedene Mentoringkurse für Frauen im Bereich Finanzen und Kapitalanlagen an, die IDF durch ihre Mitarbeiter oder selbstständige Coaches als Live-Sessions oder Aufzeichnungen zum Selbststudium anbietet (im Folgenden die „Kurse“). Zur Durchführung der Kurse betreibt IDF eine webbasierte Online-Softwareplattform, die unter anderem über eine mobile App für iOS-, Android- und vergleichbare mobile Endgeräte nutzbar ist (im Folgenden die „Online-Plattform“). Die Online-Plattform dient Kundinnen der IDF, die einen Kurs gebucht haben (im Folgenden die „Teilnehmerinnen“, IDF und Teilnehmerinnen im Folgenden einzeln auch die „Partei“, gemeinsam die „Parteien“), im Wesentlichen dazu, Aufzeichnungen abzurufen. Die Teilnahme an den einzelnen Kurseinheiten erfolgt über Softwareanwendungen von Drittanbietern (z. B. Zoom). Darüber hinaus bietet IDF den Teilnehmerinnen die Möglichkeit, ergänzende Dienste und Funktionalitäten in Anspruch zu nehmen, wie z. B. die Kommunikation der Teilnehmerinnen und Coaches miteinander (z. B. unter Nutzung von Messenger-Diensten und der Online-Plattform) und das Teilen von Materialien (im Folgenden zusammen die „Zusatzdienste“). Zusätzlich stellt IDF im Rahmen bestimmter Kurse eine webbasierte Analyse-Anwendung zur Verfügung, die teilweise KI-gestützte Funktionen enthält (im Folgenden das „Analyse-Tool“). Das Analyse-Tool ist Teil der Zusatzdienste.

2. Anwendungsbereich

2.1. Mit der Buchung eines Kurses über den Online-Shop von IDF oder durch anderweitige Vereinbarung zwischen den Parteien schließen die Parteien ein Vertragsverhältnis über die Durchführung eines Mentoringkurses (im Folgenden „Mentoringvertrag“).

2.2. Die von IDF angebotenen Kurse stellen keine Anlageberatung im Sinne des Wertpapierhandelsgesetzes dar. IDF erbringt keine individuellen Anlageempfehlungen. Im Rahmen des Mentoringvertrags schuldet IDF lediglich die Erbringung von Kursdienstleistungen. Insbesondere schuldet IDF keinen Kurserfolg, insbesondere nicht die Erzielung von Investitionsgewinnen oder bestimmten Lernergebnissen der Teilnehmerinnen. Dies gilt auch für das Analyse-Tool. Scores, Einstufungen (z. B. „überbewertet“, „Qualitätsaktie“, Burggraben- oder Management-Bewertungen) und sonstige Inhalte des Analyse-Tools sind allgemeine, für alle Nutzerinnen identische Informationen zu Lern- und Übungszwecken. Sie berücksichtigen nicht die persönlichen Verhältnisse der Teilnehmerin und stellen keine Anlageberatung, keine Finanzanalyse und keine Aufforderung zum Kauf oder Verkauf von Finanzinstrumenten dar. Anlageentscheidungen trifft die Teilnehmerin eigenverantwortlich.

2.3. Diese Nutzungsbedingungen regeln die Durchführung des Mentoringvertrags über die Online-Plattform und die Erbringung der Zusatzdienste durch IDF im Zusammenhang mit dem einzelnen Mentoringvertrag. Der mit der Teilnehmerin vereinbarte Leistungs- und Nutzungsumfang, Laufzeitbeginn und Dauer bei fortlaufenden Leistungen, die Vergütung sowie ggf. vereinbarte Zusatzbedingungen und -leistungen richten sich nach den besprochenen Leistungsbeschreibungen der Kurse, wie diese im Mentoringvertrag oder einer Auftragsbestätigung festgehalten wurden. Soweit weitere Bestimmungen des Mentoringvertrags oder einer Auftragsbestätigung in Widerspruch zu einzelnen Bestimmungen dieser Nutzungsbedingungen stehen, gehen die Bestimmungen des Mentoringvertrags oder einer Auftragsbestätigung vor.

2.4. Die Teilnehmerin hat in keinem Fall einen Anspruch darauf, dass bei Abschluss eines weiteren Mentoringvertrags oder der Änderung eines bestehenden Mentoringvertrags die bisherigen Nutzungsbedingungen fortgelten. In diesem Fall gelten die jeweils in den weiteren oder geänderten Mentoringvertrag einbezogenen Nutzungsbedingungen.

2.5. Soweit es sich bei der Teilnehmerin um eine Unternehmerin im Sinne des § 14 BGB handelt, ist die Anwendung von allgemeinen Geschäftsbedingungen der Teilnehmerin ausgeschlossen. Abweichende, entgegenstehende oder ergänzende Vertragsbedingungen der Teilnehmerin werden nur dann und insoweit Vertragsbestandteil, als IDF ihrer Geltung ausdrücklich schriftlich zugestimmt hat. Dieses Zustimmungserfordernis gilt in jedem Fall, beispielsweise auch dann, wenn IDF in Kenntnis der allgemeinen Geschäftsbedingungen der Teilnehmerin deren Zahlungen vorbehaltlos annimmt.

3. Vertragsschluss

3.1. Mentoringverträge können in Textform (z. B. per Fax, E-Mail oder über Social-Media-Kommunikationskanäle) oder online über den Online-Shop von IDF geschlossen werden. Je nach Kurs kann IDF den Vertragsschluss von einem persönlichen Erstberatungsgespräch abhängig machen. IDF behält sich vor, die Teilnehmerinnen im eigenen Ermessen auszuwählen.

3.2. Die Präsentation der Kurse auf der Website stellt kein Angebot zum Abschluss eines Mentoringvertrags dar, sondern lediglich eine unverbindliche Darstellung.

3.3. Erfolgt der Vertragsschluss über den Online-Shop, so gelten die nachfolgenden Bestimmungen:

3.3.1. Der Mentoringvertrag kommt zustande, indem (i) die Teilnehmerin als ihr Angebot auf Abschluss des Mentoringvertrags die von ihr gewünschte Leistung auswählt, ihre Zahlungsdaten angibt und die Schaltfläche „Jetzt kaufen“ betätigt; und (ii) IDF das Angebot innerhalb von fünf (5) Werktagen per E-Mail annimmt. Nimmt IDF das Angebot der Teilnehmerin innerhalb der benannten Annahmefrist nicht an, so kommt kein Mentoringvertrag zustande.

3.3.2. Bevor die Teilnehmerin die Schaltfläche „Jetzt kaufen“ betätigt, wird ihr eine Zusammenfassung der ausgewählten Leistungen und der von ihr angegebenen Daten angezeigt, und sie hat zur Vermeidung von Eingabefehlern die Gelegenheit, die von ihr bisher ausgewählten Leistungen und angegebenen Daten über vorgegebene Schaltflächen zu bearbeiten, zu löschen oder anzupassen.

3.3.3. Der Mentoringvertrag wird bei IDF gesondert gespeichert. Die Teilnehmerin hat die Möglichkeit, die zum Zeitpunkt des Vertragsschlusses gültigen Nutzungsbedingungen unter https://www.investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen abzurufen und in wiedergabefähiger Form zu speichern.

3.3.4. Sobald ein Angebot der Teilnehmerin im Sinne der Ziff. 3.3.1 bei IDF eingegangen ist, erhält die Teilnehmerin eine Auftragsbestätigung per E-Mail, die den Eingang des Angebotes bei IDF bestätigt und dessen Einzelheiten aufführt. Durch die Zusendung der Auftragsbestätigung kommt noch kein Mentoringvertrag zwischen IDF und der Teilnehmerin zustande.

3.4. Die Teilnehmerin ist zur wahrheitsgemäßen und vollständigen Angabe sämtlicher bei Vertragsschluss oder in Verbindung mit der Vertragsdurchführung erhobenen Daten verpflichtet. Bei einer Änderung der erhobenen Daten nach Vertragsschluss hat die Teilnehmerin die Änderungen IDF unverzüglich mitzuteilen.

3.5. Verbraucherinnen steht ein gesetzliches Widerrufsrecht von vierzehn (14) Tagen ab Vertragsschluss zu. Die Einzelheiten ergeben sich aus der Widerrufsbelehrung.

4. Vertragslaufzeit; Kündigung

4.1. Soweit die Parteien nichts Abweichendes vereinbaren, wird der Mentoringvertrag für die vereinbarte Laufzeit geschlossen.

4.2. Im Falle einer Mindestvertragslaufzeit verlängert sich der Mentoringvertrag nach der Mindestvertragslaufzeit auf unbestimmte Zeit, wenn er nicht vorab mit einer Frist von einem Monat zum jeweiligen Laufzeitende von einer der Parteien gekündigt wird. Nach der Verlängerung auf unbestimmte Zeit kann der Mentoringvertrag mit einer Frist von einem Monat zum Ende eines Monats gekündigt werden.

4.3. Das Recht der Parteien zur außerordentlichen Kündigung bleibt unberührt.

5. Preise; Zahlungsbedingungen

5.1. Gegenüber Verbraucherinnen im Sinne des § 13 BGB sind die angegebenen Preise Gesamtpreise. Sie enthalten die gesetzliche Umsatzsteuer, soweit diese anfällt. Einzelne Kurse sind als Bildungsleistungen nach § 4 Nr. 21 UStG von der Umsatzsteuer befreit. Bei diesen Kursen wird keine Umsatzsteuer berechnet; dies ist in der jeweiligen Leistungsbeschreibung und auf der Rechnung ausgewiesen. Gegenüber Unternehmerinnen im Sinne des § 14 BGB verstehen sich die Preise, soweit im Einzelfall nichts anderes angegeben ist, zuzüglich einer etwa anfallenden gesetzlichen Umsatzsteuer.

5.2. IDF stellt der Teilnehmerin die Kursgebühren bei Abschluss des Mentoringvertrags oder in den vereinbarten Abrechnungsintervallen in Rechnung. Rechnungsbeträge werden innerhalb von zwei Wochen nach Rechnungsstellung zur Zahlung fällig.

5.3. Im Falle des Verzugs der Teilnehmerin gelten die gesetzlichen Bestimmungen.

5.4. IDF ist berechtigt, Forderungen gegen die Teilnehmerin aus dem Mentoringvertrag an Dritte abzutreten, insbesondere zum Zwecke des Inkassos.

6. Teilnehmerinnen-Account

6.1. Voraussetzung für die Nutzung der Online-Plattform ist die Registrierung der Teilnehmerin zur Eröffnung eines Teilnehmerinnen-Accounts (im Folgenden „Account“).

6.2. Die Erstellung des Accounts erfolgt nach Zahlung der Kursgebühr, die für den jeweiligen Kurs einschlägig ist.

6.3. IDF stellt im Rahmen des Buchungsvorgangs zum Abschluss des Mentoringvertrags Zugangsdaten bereit, die der Teilnehmerin die Nutzung der Online-Plattform ermöglichen. Die Zugangsdaten eines Accounts sind nicht zeitgleich über mehrere Endgeräte nutzbar, von der Teilnehmerin streng vertraulich zu behandeln und keinem Dritten mitzuteilen. Dies gilt entsprechend für gesonderte Zugangsdaten zum Analyse-Tool.

6.4. Der Account ist nicht übertragbar. Die Überlassung der Nutzungsmöglichkeit des Accounts, der Online-Plattform und/oder des Analyse-Tools an Dritte ist unzulässig. Die Teilnehmerin ist verpflichtet, IDF unverzüglich zu informieren, wenn sie davon Kenntnis erlangt, dass ihr Account oder ihre Zugangsdaten von nicht berechtigten Personen genutzt werden.

6.5. Jede Teilnehmerin darf gleichzeitig nur einen Account unterhalten.

7. Kursumfang; Funktionalitäten der Online-Plattform

7.1. IDF übernimmt keine Garantien bezüglich der Kursinhalte oder der Erreichung bestimmter Lernergebnisse. Der genaue Leistungsumfang ergibt sich aus dem jeweiligen Mentoringvertrag und den darin beschriebenen Kursinhalten.

7.2. Soweit nicht anderweitig vereinbart, ist IDF bei der Durchführung der Kurse etwaigen Weisungen im Hinblick auf die Art der Erbringung der Leistungen, den Ort der Leistungserbringung ebenso wie die Zeit der Leistungserbringung nicht unterworfen. IDF wird die Tätigkeitszeiten selbst in der Weise festlegen, dass der Leistungszweck effektiv erreicht wird. Die Abstimmung und Koordination der Leistungserbringung mit den Teilnehmerinnen erfolgt zum Zweck der Effektivitätssteigerung.

7.3. IDF hat keinen Einfluss darauf, ob und inwiefern andere Teilnehmerinnen tatsächlich an dem jeweiligen Kurs teilnehmen und sich daran beteiligen. Das Ausbleiben einzelner oder mehrerer Teilnehmerinnen hat deshalb keinen Einfluss auf den Vergütungsanspruch von IDF gegen die Teilnehmerin.

7.4. IDF stellt die Nutzungsmöglichkeit der Online-Plattform so, wie sie ist, und entsprechend ihrem aktuellen Entwicklungsstand zur Verfügung, um die Durchführung des Kurses zu ermöglichen und ergänzende Zusatzdienste zu erbringen.

7.5. IDF ist stets bestrebt, Teilnehmerinnen moderne und nutzerfreundliche Funktionalitäten anzubieten. Die Teilnehmerin hat keinen Anspruch auf den unveränderten Bestand der Gestaltung und Funktionalitäten der Online-Plattform und des Analyse-Tools, die im Laufe des Vertragsverhältnisses Änderungen oder Aktualisierungen unterliegen können. IDF behält sich insofern vor, diese Nutzungsbedingungen sowie die angebotenen Dienstleistungen im Hinblick auf ihre Gestaltung und Funktionalitäten im Laufe des Vertragsverhältnisses unter Berücksichtigung und Abwägung der Interessen der Teilnehmerin zu ändern. Zumutbar sind insbesondere Änderungen, die durch gesetzliche oder behördliche Anforderungen erforderlich werden, die einer Anpassung an den aktuellen Stand der Technik, Sicherheitsbestimmungen oder Datenschutzbestimmungen dienen, bei denen Leistungsinhalte ganz oder teilweise gegen gleich- oder höherwertige Leistungen ausgetauscht werden und der vereinbarte Leistungsumfang im Wesentlichen unverändert bleibt.

7.6. Über sonstige Änderungen dieser Nutzungsbedingungen oder der Leistungen wird IDF die Teilnehmerin mindestens zwei Wochen vor Inkrafttreten der Änderungen per E-Mail informieren. In der E-Mail wird IDF die Teilnehmerin auf die wesentlichen Änderungen, ihr Widerspruchsrecht, die Widerspruchsfrist und die Rechtsfolgen ihres Schweigens hinweisen. Widerspricht die Teilnehmerin den neuen Nutzungsbedingungen nicht innerhalb von zwei Wochen nach Erhalt der E-Mail in Textform, gelten die Nutzungsbedingungen als zwischen den Parteien vereinbart. Widerspricht die Teilnehmerin den neuen Nutzungsbedingungen, bleibt die bisherige Version der Nutzungsbedingungen anwendbar. In diesem Fall behält IDF es sich vor, den Mentoringvertrag im Einklang mit den allgemein geltenden Vorschriften zu beenden.

7.7. Zur Durchführung des Online-Kurses greift IDF auf frei verfügbare Anwendungen und Software von Drittanbietern (wie z. B. Zoom, Skype oder Zahlungsdienstleister) zurück, die über einen Web-Browser oder als herunterladbare Software genutzt werden können. Soweit es für die Inanspruchnahme solcher Dienstleistungen erforderlich ist, ein eigenes Vertragsverhältnis mit dem jeweiligen Dritten einzugehen, gelten die jeweiligen Vertragsbedingungen dieses Drittanbieters.

7.8. Darüber hinaus stellt IDF Texte, Übersichten, Grafiken, Fotografien, Daten, Informationen oder sonstige Inhalte (im Folgenden „Materialien“) auf der Online-Plattform bereit.

7.9. Soweit der Mentoringvertrag den Zugriff auf Aufzeichnungen durchgeführter Live-Calls vorsieht, stellt IDF der Teilnehmerin diese Aufzeichnungen („Live-Call-Aufzeichnungen“) während des hierfür vereinbarten Zugriffszeitraums zur Verfügung. Live-Call-Aufzeichnungen sind von den Kursvideos (Ziff. 11.2) zu unterscheiden. IDF ist berechtigt, die zuletzt durchgeführten Live-Call-Aufzeichnungen automatisiert über die Online-Plattform bereitzustellen und ältere Aufzeichnungen aus demselben Zeitraum auf Anfrage der Teilnehmerin über den Customer Service zugänglich zu machen. Der Umfang der automatisiert über die Online-Plattform bereitgestellten Aufzeichnungen kann sich im Rahmen der Weiterentwicklung der Online-Plattform ändern, ohne dass hierdurch die vereinbarte Gesamtdauer oder der Gesamtumfang des Zugriffs (Ziff. 2.3) berührt wird. IDF bearbeitet Anfragen nach älteren Aufzeichnungen innerhalb von zwei (2) Werktagen.

7a. Analyse-Tool

7a.1. Soweit der Mentoringvertrag dies vorsieht, erhält die Teilnehmerin Zugang zum Analyse-Tool. Der Funktionsumfang ergibt sich aus der jeweiligen Leistungsbeschreibung und umfasst derzeit insbesondere ein Haushaltsbuch, ein Handelstagebuch, eine Einstiegsplanung, die Erfassung eigener Fundamentalanalysen sowie automatisch erstellte Unternehmensinformationen.

7a.2. Einzelne Funktionen des Analyse-Tools werden freigeschaltet, sobald die Teilnehmerin eine festgelegte Anzahl eigener Analysen vollständig erfasst hat. Die Freischaltung erfolgt automatisiert. Eine inhaltliche Prüfung oder Bewertung der Analysen durch IDF findet nicht statt.

7a.3. Kurs-, Unternehmens- und Kennzahlendaten bezieht IDF von Drittanbietern. Diese Daten können verzögert, unvollständig oder fehlerhaft sein. IDF prüft sie nicht im Einzelfall.

7a.4. Einzelne Inhalte des Analyse-Tools (z. B. Burggraben-, SWOT- und Management-Einschätzungen) werden mithilfe künstlicher Intelligenz automatisiert erstellt und als solche gekennzeichnet. Sie werden vor ihrer Anzeige nicht redaktionell geprüft und können sachlich falsch, veraltet oder unvollständig sein. Die Teilnehmerin soll diese Inhalte vor jeder Entscheidung anhand der Primärquellen des jeweiligen Unternehmens (z. B. Geschäftsberichte, Investor-Relations-Seiten) überprüfen.

7a.5. Berechnungen des Analyse-Tools (z. B. Scores) beruhen auf den im Kurs vermittelten Kriterien und auf den von der Teilnehmerin eingegebenen Daten. Für die Richtigkeit ihrer eigenen Eingaben ist die Teilnehmerin selbst verantwortlich.

7a.6. Die Teilnehmerin kann ihre im Analyse-Tool gespeicherten Daten während der Zugriffsdauer exportieren. IDF löscht diese Daten drei (3) Monate nach Ende der Zugriffsdauer, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen. IDF weist die Teilnehmerin rechtzeitig vor der Löschung per E-Mail darauf hin.

8. Pflichten der Teilnehmerin

8.1. Die Teilnehmerin hat auf eigene Kosten die für die Nutzung der Online-Plattform und der Zusatzdienste erforderliche Hardware (z. B. Endgerät, Mikrofon, Webcam), Software (inklusive frei verfügbarer Software von Drittanbietern, z. B. zur Durchführung von Videokonferenzen) sowie einen Internetanschluss bereitzuhalten. Soweit der Drittanbieter zur Nutzung seiner Software die Erstellung eines Accounts verlangt, ist die Teilnehmerin verpflichtet, sich für einen solchen Account zu registrieren. IDF ist nicht verantwortlich für Ausfälle oder andere technische Probleme, die sich im Zusammenhang mit der Nutzung dieser Drittsoftware ergeben.

8.2. Die Teilnehmerin hat in eigener Verantwortung die zum Schutz vor Zugriffen Dritter notwendigen Schutzvorkehrungen für die von ihr verwendete Hard- und Software inklusive ihres Systems zu treffen. Dies beinhaltet insbesondere die Nutzung der gängigen Sicherheitseinstellungen der von der Teilnehmerin verwendeten Browsersoftware, eine regelmäßige Sicherung der Daten sowie die Verwendung einer Firewall und einer aktuellen Schutzsoftware zur Abwehr von Computerviren.

8.3. Die Teilnehmerin darf auf die Online-Plattform und die Zusatzdienste nur auf eine Art zugreifen und sie nutzen, für die ihr das Recht zum Zugriff und zur Nutzung gewährt wurde und wie es zum Zweck des Mentoringvertrags vernünftigerweise erforderlich ist.

8.4. Die Teilnehmerin hat sich stets im Interesse eines ordnungsgemäßen Betriebs der Online-Plattform zu verhalten und jegliche Betätigungen zu unterlassen, die eine ordnungsgemäße Durchführung des Kurses unterbrechen oder stören könnten. Hierzu hat sie insbesondere

8.4.1. sicherzustellen, dass Dritte keine Nutzungsmöglichkeit der Online-Plattform, des Analyse-Tools sowie des Kurses haben;

8.4.2. den virtuellen Kursraum pünktlich zu betreten;

8.4.3. aggressives, beleidigendes sowie rassistisches oder sexistisches Verhalten zu unterlassen;

8.4.4. keine kursfremden oder unangemessenen Inhalte, insbesondere Werbung und Spam, zu teilen oder zu verwenden;

8.4.5. eigenmächtige Aufzeichnungen der Inhalte oder des Kurses zu unterlassen;

8.4.6. in technischer Hinsicht allgemein geltende technische Sicherheitsstandards zu wahren;

8.4.7. zu unterlassen, die Online-Plattform einer übermäßigen Belastung auszusetzen oder auf jede andere Weise ihr Funktionieren zu stören oder zu gefährden;

8.4.8. ohne schriftliche Zustimmung keine Crawler, Spider, Scraper oder anderen automatisierten Mechanismen zu nutzen, um auf die Online-Plattform zuzugreifen und Inhalte zu sammeln;

8.4.9. keine Informationen wie E-Mail-Adressen oder Rufnummern anderer Benutzerinnen ohne vorherige Einwilligung zu sammeln oder zu verwenden;

8.4.10. auf die Bereitstellung und Verwendung von Malware, Viren und anderen Schadprogrammen zu verzichten;

8.4.11. Inhalte des Analyse-Tools (insbesondere Scores und KI-generierte Analysen) nicht systematisch auszulesen, zu vervielfältigen oder Dritten, z. B. in sozialen Medien, Chatgruppen oder eigenen Angeboten, zugänglich zu machen.

8.5. Die Nutzung der Online-Plattform, der Zusatzdienste und das sonstige Verhalten der Teilnehmerinnen müssen im Einklang mit den geltenden Gesetzen stehen. Die Teilnehmerinnen sind allein dafür verantwortlich, die für sie geltenden Gesetze und Bestimmungen zu kennen und einzuhalten.

8.6. Bei Abruf, Erstellung, Bereitstellung, öffentlicher Zugänglichmachung und Verbreitung von Materialien, Chatnachrichten und anderen Inhalten sind die Lizenzbedingungen zu beachten, unter denen diese Inhalte auf der Online-Plattform zur Verfügung gestellt werden.

8.7. Die Teilnehmerin trägt die alleinige Verantwortung für alle Inhalte, die sie auf der Online-Plattform einstellt. Abruf, Erstellung, Bereitstellung, öffentliche Zugänglichmachung und Verbreitung von rechtswidrigen Inhalten, insbesondere solchen, die gegen strafrechtliche oder persönlichkeitsrechtliche Bestimmungen oder gewerbliche Schutzrechte Dritter verstoßen, sind zu unterlassen. Die Teilnehmerin wird eine solche Handlung nur vornehmen, sofern sie nach ihrem besten Wissen

8.7.1. Inhaberin sämtlicher Rechte an den Inhalten ist oder alle erforderlichen Lizenzen und Genehmigungen zur Nutzung, öffentlichen Zugänglichmachung und Veröffentlichung der Inhalte innehat;

8.7.2. die Inhalte keine geistigen Eigentumsrechte oder andere Rechte Dritter verletzen;

8.7.3. die Inhalte nach ihrem besten Wissen nicht gegen Gesetze oder andere Bestimmungen verstoßen, insbesondere nicht verleumderisch oder beleidigend sind.

8.8. IDF behält sich das Recht vor, Inhalte zu entfernen, die gegen diese Anforderungen verstoßen. Das bedeutet jedoch nicht, dass IDF Inhalte proaktiv sichtet oder auf ihre Rechtmäßigkeit hin überprüft. IDF leitet solche Maßnahmen ohne Anerkennung einer rechtlichen Verpflichtung, unbeschadet und ohne Verzicht auf bestehende Ansprüche, Rechte oder Rechtsmittel ein und behält sich deren Geltendmachung ausdrücklich vor. Im Fall von rechtswidrigen Inhalten, die von Teilnehmerinnen zur Verfügung gestellt werden, sind zudem die Anforderungen der Ziff. 9 dieser Nutzungsbedingungen zu beachten.

8.9. Verstößt eine Teilnehmerin gegen diese Nutzungsbedingungen, insbesondere die Verhaltenspflichten unter Ziff. 8.4, oder anderweitig geltende Gesetze oder Bestimmungen, kann IDF, sofern vorhanden durch den jeweiligen Coach, geeignete und angemessene Abhilfemaßnahmen ergreifen. Dazu können insbesondere die Ermahnung der Teilnehmerin, die Information der IDF, das Entfernen rechtswidriger Inhalte sowie der Ausschluss aus einzelnen Kurseinheiten zählen. Die endgültige Entscheidung über eine weitere Teilnahme der Teilnehmerin an dem Kurs und den Umfang ihrer Nutzungsmöglichkeiten der Online-Plattform und der Zusatzdienste bleibt IDF vorbehalten.

9. Melde- und Abhilfeverfahren für rechtswidrige Inhalte

9.1. Im Rahmen der Möglichkeit für Teilnehmerinnen, Materialien über die Online-Plattform bereitzustellen und die Chat-Funktion zu nutzen, speichert IDF von der Teilnehmerin bereitgestellte Informationen in deren Auftrag.

9.2. Sind Teilnehmerinnen der Ansicht, dass diese Materialien insoweit rechtswidrig sind, als sie nicht im Einklang mit dem Recht der Europäischen Union oder dem Recht eines EU-Mitgliedstaats stehen, haben sie die Möglichkeit, diese gegenüber IDF zu melden. Dies kann per E-Mail an service@investieredichfrei.de geschehen.

9.3. In einer solchen Meldung sind die folgenden Informationen anzugeben:

9.3.1. eine hinreichend begründete Erläuterung, warum die fraglichen Informationen als rechtswidrige Inhalte angesehen werden;

9.3.2. eine eindeutige Angabe des genauen elektronischen Speicherorts dieser Informationen oder, soweit erforderlich, weitere, hinsichtlich der Art der Inhalte und der konkreten Art des Dienstes zweckdienliche Angaben zur Ermittlung der rechtswidrigen Inhalte;

9.3.3. den Namen und die E-Mail-Adresse des Meldenden; das gilt nicht, wenn es sich um Informationen handelt, bei denen der Meldende davon ausgeht, dass die Meldung eine Straftat im Zusammenhang mit sexuellem Missbrauch, sexueller Ausbeutung, Kinderpornografie, der Kontaktaufnahme zu Kindern für sexuelle Zwecke oder Anstiftung, Beihilfe oder Versuch zu solchen Straftaten betrifft. In diesen oder anderen Fällen, in denen der Meldende eine Meldung ohne Identifizierungsmöglichkeit abgeben möchte, kann er sich an service@investieredichfrei.de wenden;

9.3.4. eine Erklärung darüber, dass der Meldende in gutem Glauben davon überzeugt ist, dass die in der Meldung enthaltenen Angaben und Ausführungen richtig und vollständig sind.

9.4. IDF wird alle Meldungen zeitnah, sorgfältig, frei von Willkür und objektiv bearbeiten. IDF teilt dem Meldenden ihre Entscheidung über die Rechtswidrigkeit des Inhalts unverzüglich mit und weist auf etwaige Rechtsbehelfe hin. Im Fall einer Beschränkung begründet IDF ihre Entscheidung gegenüber allen Betroffenen klar und spezifisch.

10. Technische Maßnahmen, Wartung und Support

10.1. Um die Online-Plattform vor schädlichen Programmen und Inhalten wie z. B. Viren, Trojanern oder Spamnachrichten zu schützen, kann IDF technische Schutzmaßnahmen ergreifen. Dies kann auch den Einsatz von Filtersystemen beinhalten, soweit ein solcher zum Schutz der Telekommunikations- und Datenverarbeitungssysteme angemessen ist.

10.2. IDF unternimmt angemessene Anstrengungen, eine Verfügbarkeit der Online-Plattform von nicht weniger als 99,1 % des Kalenderjahres zu gewährleisten. Hiervon ausgenommen sind temporäre Nichtverfügbarkeiten aufgrund von planmäßigen oder außerplanmäßigen Wartungsarbeiten sowie aus Gründen, auf die IDF keinen Einfluss hat (z. B. höhere Gewalt, Stromausfälle, Ausfälle öffentlicher Telekommunikationsnetze oder Ausfälle von Datenlieferanten). Die Voraussetzungen der Ziff. 12.2 und 12.3 bleiben hierdurch unberührt. IDF unternimmt angemessene Anstrengungen, planmäßige Unterbrechungen der Online-Plattform oder der Zusatzdienste im Voraus anzukündigen.

Darüber hinaus ist IDF nicht verpflichtet, in regelmäßigen Abständen oder auf Anweisung Dritter Wartungsarbeiten an der Online-Plattform sowie den Zusatzdiensten oder Updates, Upgrades oder Patches durchzuführen. Sollte es zu solchen Wartungsarbeiten kommen, weist IDF darauf hin, dass die Nutzbarkeit der Online-Plattform sowie der Zusatzdienste während solcher Wartungsfenster eingeschränkt sein kann.

10.3. Bei technischen Problemen bezüglich der Online-Plattform oder des Analyse-Tools kann sich die Teilnehmerin an service@investieredichfrei.de wenden.

11. Nutzungsrechte, Rechteeinräumung

11.1. IDF oder ihre Lizenzgeber sind Inhaber sämtlicher Rechte an der Online-Plattform, dem Analyse-Tool und ihren Inhalten.

11.2. IDF räumt den Teilnehmerinnen ein nicht-ausschließliches, nicht-übertragbares und widerrufliches Recht zum Zugriff auf die Online-Plattform und die Zusatzdienste sowie ihre Nutzung für die Zwecke des Mentoringvertrags begrenzt auf ein Jahr nach Ende des jeweiligen Kurses ein, d. h. dem Laden und Aufruf zur Teilnahme an den Kurseinheiten, Kommunikation mit IDF einschließlich der Coaches und anderen Teilnehmerinnen sowie der Live-Call-Aufzeichnungen im Rahmen der hierfür vereinbarten Zugriffsdauer (Ziff. 7.9), für ausschließlich private, nicht-kommerzielle Zwecke. In Hinblick auf Kursvideos und herunterladbare Kursmaterialien (z. B. Excel-Dateien, Workbooks) räumt IDF den Teilnehmerinnen ein zeitlich unbegrenztes Nutzungsrecht für ausschließlich private, nicht-kommerzielle Zwecke ein. Das Analyse-Tool ist kein Kursmaterial im Sinne des vorstehenden Satzes. Der Zugang zum Analyse-Tool besteht für die im Mentoringvertrag vereinbarte Dauer, andernfalls für die Dauer des Zugriffs auf die Online-Plattform nach Satz 1.

11.3. IDF behält sich das Recht vor, die Lizenz für den Zugriff auf Inhalte der Online-Plattform jederzeit zu widerrufen, wenn IDF aus rechtlichen Gründen hierzu verpflichtet ist oder aus anderen gleichwertigen Gründen den Zugang zu einzelnen Inhalten oder der Online-Plattform deaktiviert. Das ist z. B. dann der Fall, wenn IDF feststellt, dass es sich um rechtswidrige Inhalte im Sinne von Ziff. 8.7 dieser Nutzungsbedingungen handelt.

11.4. Die Teilnehmerin räumt IDF auf weltweiter Basis ein nicht-ausschließliches Recht zur öffentlichen Zugänglichmachung sowie zum Abruf und zur Nutzung der Materialien und anderen Inhalte, die sie auf der Online-Plattform bereitstellt, für die Zwecke des Mentoringvertrags und der Durchführung des Investmentkurses ein. Daten, die die Teilnehmerin im Analyse-Tool zu ihren eigenen Finanzen und Analysen erfasst, sind hiervon ausgenommen. Sie werden nur zur Bereitstellung der Funktionen für die Teilnehmerin genutzt.

12. Haftung

12.1. IDF haftet auf Schadensersatz bei Vorsatz und grober Fahrlässigkeit.

12.2. Bei einfacher Fahrlässigkeit haftet IDF nur für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit und für Schäden aus der Verletzung einer wesentlichen Vertragspflicht. Um eine wesentliche Vertragspflicht handelt es sich bei einer Verpflichtung, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf deren Einhaltung die Teilnehmerin regelmäßig vertraut und vertrauen darf. Im Fall der Verletzung einer wesentlichen Vertragspflicht ist die Haftung von IDF auf den Ersatz des bei Vertragsschluss vorhersehbaren, typischerweise eintretenden Schadens begrenzt, es sei denn, es handelt sich um Schadensersatzansprüche aufgrund einer Verletzung des Lebens, des Körpers oder der Gesundheit oder eine Haftungsbeschränkung ist aus anderen Gründen nicht zulässig.

12.3. Die Haftungsbeschränkungen nach Ziff. 12.2 gelten nicht, soweit IDF eine Garantie übernommen oder einen Mangel der Vertragsleistungen arglistig verschwiegen hat. Diese Haftungsbeschränkungen gelten ebenfalls nicht für Ansprüche nach dem Produkthaftungsgesetz und nach anwendbaren Gesetzen zum Schutz personenbezogener Daten.

12.4. Die Haftungsregelungen aus Ziff. 12.2 und 12.3 gelten auch für die Haftung der gesetzlichen Vertreter, Erfüllungsgehilfen, Organe und Mitarbeiter von IDF.

12.5. Soweit auf die Nutzung der Online-Plattform oder der Zusatzdienste Mietrecht anwendbar ist, haftet IDF nicht für anfängliche Mängel, soweit nicht die Voraussetzungen der Ziff. 12.2 und 12.3 vorliegen.

12.6. Ersatzansprüche der Teilnehmerinnen gegen IDF verjähren innerhalb von 12 Monaten. Dies gilt nicht, soweit die Ansprüche auf einer vorsätzlichen oder grob fahrlässigen Haupt- oder Nebenpflichtverletzung von IDF, einer Verletzung des Lebens, des Körpers oder der Gesundheit, der Verletzung einer Kardinalpflicht oder, soweit auf die Zusatzdienste anwendbar, auf Mängelgewährleistungsansprüchen beruhen.

12.7. Zusätzlich zu den Voraussetzungen der Ziff. 12.2 und 12.3 ist der Anspruch der Teilnehmerinnen auf Schadensersatz wegen Datenverlusts in der Höhe auf den Schaden begrenzt, der auch bei ordentlicher Datensicherung durch die Teilnehmerinnen entstanden wäre.

13. Datenschutz

Es gelten die anwendbaren und einschlägigen datenschutzrechtlichen Vorschriften, insbesondere die der Datenschutz-Grundverordnung und des Bundesdatenschutzgesetzes. Für Informationen über die Verarbeitung personenbezogener Daten der Teilnehmerinnen wird auf die Datenschutzhinweise verwiesen. Im Analyse-Tool verarbeitet IDF die von der Teilnehmerin eingegebenen Finanzdaten ausschließlich zur Bereitstellung der Funktionen. Für KI-gestützte Funktionen setzt IDF Auftragsverarbeiter ein. Einzelheiten, einschließlich etwaiger Übermittlungen in Drittländer, ergeben sich aus den Datenschutzhinweisen.

14. Schlussbestimmungen

14.1. Soweit eine oder mehrere Bestimmungen dieser AGB unzulässig, unwirksam oder unausführbar sind, wird dadurch die Zulässigkeit, Wirksamkeit oder Ausführbarkeit der übrigen Bestimmungen nicht berührt.

14.2. IDF ist berechtigt, den Mentoringvertrag oder die sich aus dem Mentoringvertrag ergebenden Rechte oder Pflichten an einen Dritten zu übertragen. In diesem Fall wird IDF der Teilnehmerin das Recht einräumen, sich von dem Mentoringvertrag im Wege der Kündigung zu lösen. Macht die Teilnehmerin von ihrem Kündigungsrecht keinen Gebrauch, gelten alle IDF eingeräumten Rechte zugleich als dem jeweiligen Rechtsnachfolger eingeräumt.

14.3. Auf das Vertragsverhältnis zwischen IDF und der Teilnehmerin sowie auf diese Nutzungsbedingungen findet ausschließlich das Recht der Bundesrepublik Deutschland Anwendung. Die Anwendung des UN-Kaufrechts (CISG) ist ausgeschlossen.

14.4. Soweit das Vertragsverhältnis mit einer Unternehmerin im Sinne des § 14 BGB zustande kommt, ist Gerichtsstand für alle Rechtsstreitigkeiten, die sich unmittelbar oder mittelbar aus dem Vertragsverhältnis zwischen IDF und der Teilnehmerin ergeben, soweit zulässig, Hannover.

14.5. IDF ist zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle weder verpflichtet noch bereit.

Stand: Oktober 2026$rechtstext$, '2026-10-30 00:00 Europe/Berlin'),
  ('datenschutz', 'Stand 09.08.2025', $rechtstext$Datenschutzerklärung

Stand: 09.08.2025

Wir freuen uns sehr über Ihr Interesse an unserem Unternehmen. Eine Nutzung der Internetseiten ist grundsätzlich ohne jede Angabe personenbezogener Daten möglich. Sofern eine betroffene Person besondere Services unseres Unternehmens über unsere Internetseite in Anspruch nehmen möchte, könnte jedoch eine Verarbeitung personenbezogener Daten erforderlich werden. Ist die Verarbeitung personenbezogener Daten erforderlich und besteht für eine solche Verarbeitung keine gesetzliche Grundlage, holen wir generell eine Einwilligung der betroffenen Person ein.

Die Verarbeitung personenbezogener Daten, beispielsweise des Namens, der Anschrift, E-Mail-Adresse oder Telefonnummer einer betroffenen Person, erfolgt stets im Einklang mit der Datenschutz-Grundverordnung und in Übereinstimmung mit den für uns geltenden landesspezifischen Datenschutzbestimmungen. Mittels dieser Datenschutzerklärung möchte unser Unternehmen die Öffentlichkeit über Art, Umfang und Zweck der von uns erhobenen, genutzten und verarbeiteten personenbezogenen Daten informieren. Ferner werden betroffene Personen mittels dieser Datenschutzerklärung über die ihnen zustehenden Rechte aufgeklärt.

Wir haben als für die Verarbeitung Verantwortlicher zahlreiche technische und organisatorische Maßnahmen umgesetzt, um einen möglichst lückenlosen Schutz der über diese Internetseite verarbeiteten personenbezogenen Daten sicherzustellen. Dennoch können Internetbasierte Datenübertragungen grundsätzlich Sicherheitslücken aufweisen, sodass ein absoluter Schutz nicht gewährleistet werden kann. Aus diesem Grund steht es jeder betroffenen Person frei, personenbezogene Daten auch auf alternativen Wegen, beispielsweise telefonisch, an uns zu übermitteln.

Begriffsbestimmungen

Die Datenschutzerklärung beruht auf den Begrifflichkeiten, die durch den Europäischen Richtlinien- und Verordnungsgeber beim Erlass der Datenschutz-Grundverordnung (DS-GVO) verwendet wurden. Unsere Datenschutzerklärung soll sowohl für die Öffentlichkeit als auch für unsere Kunden und Geschäftspartner einfach lesbar und verständlich sein. Um dies zu gewährleisten, möchten wir vorab die verwendeten Begrifflichkeiten erläutern.

Wir verwenden in dieser Datenschutzerklärung unter anderem die folgenden Begriffe:

- a) personenbezogene Daten
- Personenbezogene Daten sind alle Informationen, die sich auf eine identifizierte oder identifizierbare natürliche Person (im Folgenden „betroffene Person") beziehen. Als identifizierbar wird eine natürliche Person angesehen, die direkt oder indirekt, insbesondere mittels Zuordnung zu einer Kennung wie einem Namen, zu einer Kennnummer, zu Standortdaten, zu einer Online-Kennung oder zu einem oder mehreren besonderen Merkmalen, die Ausdruck der physischen, physiologischen, genetischen, psychischen, wirtschaftlichen, kulturellen oder sozialen Identität dieser natürlichen Person sind, identifiziert werden kann.
- b) betroffene Person
- Betroffene Person ist jede identifizierte oder identifizierbare natürliche Person, deren personenbezogene Daten von dem für die Verarbeitung Verantwortlichen verarbeitet werden.
- c) Verarbeitung
- Verarbeitung ist jeder mit oder ohne Hilfe automatisierter Verfahren ausgeführte Vorgang oder jede solche Vorgangsreihe im Zusammenhang mit personenbezogenen Daten wie das Erheben, das Erfassen, die Organisation, das Ordnen, die Speicherung, die Anpassung oder Veränderung, das Auslesen, das Abfragen, die Verwendung, die Offenlegung durch Übermittlung, Verbreitung oder eine andere Form der Bereitstellung, den Abgleich oder die Verknüpfung, die Einschränkung, das Löschen oder die Vernichtung.
- d) Einschränkung der Verarbeitung
- Einschränkung der Verarbeitung ist die Markierung gespeicherter personenbezogener Daten mit dem Ziel, ihre künftige Verarbeitung einzuschränken.
- e) Profiling
- Profiling ist jede Art der automatisierten Verarbeitung personenbezogener Daten, die darin besteht, dass diese personenbezogenen Daten verwendet werden, um bestimmte persönliche Aspekte, die sich auf eine natürliche Person beziehen, zu bewerten, insbesondere, um Aspekte bezüglich Arbeitsleistung, wirtschaftlicher Lage, Gesundheit, persönlicher Vorlieben, Interessen, Zuverlässigkeit, Verhalten, Aufenthaltsort oder Ortswechsel dieser natürlichen Person zu analysieren oder vorherzusagen.
- f) Pseudonymisierung
- Pseudonymisierung ist die Verarbeitung personenbezogener Daten in einer Weise, auf welche die personenbezogenen Daten ohne Hinzuziehung zusätzlicher Informationen nicht mehr einer spezifischen betroffenen Person zugeordnet werden können, sofern diese zusätzlichen Informationen gesondert aufbewahrt werden und technischen und organisatorischen Maßnahmen unterliegen, die gewährleisten, dass die personenbezogenen Daten nicht einer identifizierten oder identifizierbaren natürlichen Person zugewiesen werden.
- g) Verantwortlicher oder für die Verarbeitung Verantwortlicher
- Verantwortlicher oder für die Verarbeitung Verantwortlicher ist die natürliche oder juristische Person, Behörde, Einrichtung oder andere Stelle, die allein oder gemeinsam mit anderen über die Zwecke und Mittel der Verarbeitung von personenbezogenen Daten entscheidet. Sind die Zwecke und Mittel dieser Verarbeitung durch das Unionsrecht oder das Recht der Mitgliedstaaten vorgegeben, so kann der Verantwortliche beziehungsweise können die bestimmten Kriterien seiner Benennung nach dem Unionsrecht oder dem Recht der Mitgliedstaaten vorgesehen werden.
- h) Auftragsverarbeiter
- Auftragsverarbeiter ist eine natürliche oder juristische Person, Behörde, Einrichtung oder andere Stelle, die personenbezogene Daten im Auftrag des Verantwortlichen verarbeitet.
- i) Empfänger
- Empfänger ist eine natürliche oder juristische Person, Behörde, Einrichtung oder andere Stelle, der personenbezogene Daten offengelegt werden, unabhängig davon, ob es sich bei ihr um einen Dritten handelt oder nicht. Behörden, die im Rahmen eines bestimmten Untersuchungsauftrags nach dem Unionsrecht oder dem Recht der Mitgliedstaaten möglicherweise personenbezogene Daten erhalten, gelten jedoch nicht als Empfänger.
- j) Dritter
- Dritter ist eine natürliche oder juristische Person, Behörde, Einrichtung oder andere Stelle außer der betroffenen Person, dem Verantwortlichen, dem Auftragsverarbeiter und den Personen, die unter der unmittelbaren Verantwortung des Verantwortlichen oder des Auftragsverarbeiters befugt sind, die personenbezogenen Daten zu verarbeiten.
- k) Einwilligung
- Einwilligung ist jede von der betroffenen Person freiwillig für den bestimmten Fall in informierter Weise und unmissverständlich abgegebene Willensbekundung in Form einer Erklärung oder einer sonstigen eindeutigen bestätigenden Handlung, mit der die betroffene Person zu verstehen gibt, dass sie mit der Verarbeitung der sie betreffenden personenbezogenen Daten einverstanden ist.

Name und Anschrift des für die Verarbeitung Verantwortlichen

Verantwortlicher im Sinne der Datenschutz-Grundverordnung, sonstiger in den Mitgliedstaaten der Europäischen Union geltenden Datenschutzgesetze und anderer Bestimmungen mit datenschutzrechtlichem Charakter ist die:

Investiere Dich Frei GmbH

Emilia Bolda

Hauptstraße 28

30982 Pattensen

Deutschland

05069-4399955

E-Mail: service@investieredichfrei.de

DE456528973

Cookies / SessionStorage / LocalStorage

Die Internetseiten verwenden teilweise so genannte Cookies, LocalStorage und SessionStorage. Dies dient dazu, unser Angebot nutzerfreundlicher, effektiver und sicherer zu machen. Local Storage und SessionStorage ist eine Technologie, mit welcher ihr Browser Daten auf Ihrem Computer oder mobilen Gerät abspeichert. Cookies sind Textdateien, welche über einen Internetbrowser auf einem Computersystem abgelegt und gespeichert werden. Sie können die Verwendung von Cookies, LocalStorage und SessionStorage durch entsprechende Einstellung in Ihrem Browser verhindern.

Zahlreiche Internetseiten und Server verwenden Cookies. Viele Cookies enthalten eine sogenannte Cookie-ID. Eine Cookie-ID ist eine eindeutige Kennung des Cookies. Sie besteht aus einer Zeichenfolge, durch welche Internetseiten und Server dem konkreten Internetbrowser zugeordnet werden können, in dem das Cookie gespeichert wurde. Dies ermöglicht es den besuchten Internetseiten und Servern, den individuellen Browser der betroffenen Person von anderen Internetbrowsern, die andere Cookies enthalten, zu unterscheiden. Ein bestimmter Internetbrowser kann über die eindeutige Cookie-ID wiedererkannt und identifiziert werden.

Durch den Einsatz von Cookies kann den Nutzern dieser Internetseite nutzerfreundlichere Services bereitstellen, die ohne die Cookie-Setzung nicht möglich wären.

Mittels eines Cookies können die Informationen und Angebote auf unserer Internetseite im Sinne des Benutzers optimiert werden. Cookies ermöglichen uns, wie bereits erwähnt, die Benutzer unserer Internetseite wiederzuerkennen. Zweck dieser Wiedererkennung ist es, den Nutzern die Verwendung unserer Internetseite zu erleichtern. Der Benutzer einer Internetseite, die Cookies verwendet, muss beispielsweise nicht bei jedem Besuch der Internetseite erneut seine Zugangsdaten eingeben, weil dies von der Internetseite und dem auf dem Computersystem des Benutzers abgelegten Cookie übernommen wird. Ein weiteres Beispiel ist das Cookie eines Warenkorbes im Online-Shop. Der Online-Shop merkt sich die Artikel, die ein Kunde in den virtuellen Warenkorb gelegt hat, über ein Cookie.

Die betroffene Person kann die Setzung von Cookies durch unsere Internetseite jederzeit mittels einer entsprechenden Einstellung des genutzten Internetbrowsers verhindern und damit der Setzung von Cookies dauerhaft widersprechen. Ferner können bereits gesetzte Cookies jederzeit über einen Internetbrowser oder andere Softwareprogramme gelöscht werden. Dies ist in allen gängigen Internetbrowsern möglich. Deaktiviert die betroffene Person die Setzung von Cookies in dem genutzten Internetbrowser, sind unter Umständen nicht alle Funktionen unserer Internetseite vollumfänglich nutzbar.

Erfassung von allgemeinen Daten und Informationen

Die Internetseite erfasst mit jedem Aufruf der Internetseite durch eine betroffene Person oder ein automatisiertes System eine Reihe von allgemeinen Daten und Informationen. Diese allgemeinen Daten und Informationen werden in den Logfiles des Servers gespeichert. Erfasst werden können die (1) verwendeten Browsertypen und Versionen, (2) das vom zugreifenden System verwendete Betriebssystem, (3) die Internetseite, von welcher ein zugreifendes System auf unsere Internetseite gelangt (sogenannte Referrer), (4) die Unterwebseiten, welche über ein zugreifendes System auf unserer Internetseite angesteuert werden, (5) das Datum und die Uhrzeit eines Zugriffs auf die Internetseite, (6) eine Internet-Protokoll-Adresse (IP-Adresse), (7) der Internet-Service-Provider des zugreifenden Systems und (8) sonstige ähnliche Daten und Informationen, die der Gefahrenabwehr im Falle von Angriffen auf unsere informationstechnologischen Systeme dienen.

Bei der Nutzung dieser allgemeinen Daten und Informationen ziehen wird keine Rückschlüsse auf die betroffene Person. Diese Informationen werden vielmehr benötigt, um (1) die Inhalte unserer Internetseite korrekt auszuliefern, (2) die Inhalte unserer Internetseite sowie die Werbung für diese zu optimieren, (3) die dauerhafte Funktionsfähigkeit unserer informationstechnologischen Systeme und der Technik unserer Internetseite zu gewährleisten sowie (4) um Strafverfolgungsbehörden im Falle eines Cyberangriffes die zur Strafverfolgung notwendigen Informationen bereitzustellen. Diese anonym erhobenen Daten und Informationen werden durch uns daher einerseits statistisch und ferner mit dem Ziel ausgewertet, den Datenschutz und die Datensicherheit in unserem Unternehmen zu erhöhen, um letztlich ein optimales Schutzniveau für die von uns verarbeiteten personenbezogenen Daten sicherzustellen. Die anonymen Daten der Server-Logfiles werden getrennt von allen durch eine betroffene Person angegebenen personenbezogenen Daten gespeichert.

Registrierung auf unserer Internetseite

Die betroffene Person hat die Möglichkeit, sich auf der Internetseite des für die Verarbeitung Verantwortlichen unter Angabe von personenbezogenen Daten zu registrieren. Welche personenbezogenen Daten dabei an den für die Verarbeitung Verantwortlichen übermittelt werden, ergibt sich aus der jeweiligen Eingabemaske, die für die Registrierung verwendet wird. Die von der betroffenen Person eingegebenen personenbezogenen Daten werden ausschließlich für die interne Verwendung bei dem für die Verarbeitung Verantwortlichen und für eigene Zwecke erhoben und gespeichert. Der für die Verarbeitung Verantwortliche kann die Weitergabe an einen oder mehrere Auftragsverarbeiter, beispielsweise einen Paketdienstleister, veranlassen, der die personenbezogenen Daten ebenfalls ausschließlich für eine interne Verwendung, die dem für die Verarbeitung Verantwortlichen zuzurechnen ist, nutzt.

Durch eine Registrierung auf der Internetseite des für die Verarbeitung Verantwortlichen wird ferner die vom Internet-Service-Provider (ISP) der betroffenen Person vergebene IP-Adresse, das Datum sowie die Uhrzeit der Registrierung gespeichert. Die Speicherung dieser Daten erfolgt vor dem Hintergrund, dass nur so der Missbrauch unserer Dienste verhindert werden kann, und diese Daten im Bedarfsfall ermöglichen, begangene Straftaten aufzuklären. Insofern ist die Speicherung dieser Daten zur Absicherung des für die Verarbeitung Verantwortlichen erforderlich. Eine Weitergabe dieser Daten an Dritte erfolgt grundsätzlich nicht, sofern keine gesetzliche Pflicht zur Weitergabe besteht oder die Weitergabe der Strafverfolgung dient.

Die Registrierung der betroffenen Person unter freiwilliger Angabe personenbezogener Daten dient dem für die Verarbeitung Verantwortlichen dazu, der betroffenen Person Inhalte oder Leistungen anzubieten, die aufgrund der Natur der Sache nur registrierten Benutzern angeboten werden können. Registrierten Personen steht die Möglichkeit frei, die bei der Registrierung angegebenen personenbezogenen Daten jederzeit abzuändern oder vollständig aus dem Datenbestand des für die Verarbeitung Verantwortlichen löschen zu lassen.

Der für die Verarbeitung Verantwortliche erteilt jeder betroffenen Person jederzeit auf Anfrage Auskunft darüber, welche personenbezogenen Daten über die betroffene Person gespeichert sind. Ferner berichtigt oder löscht der für die Verarbeitung Verantwortliche personenbezogene Daten auf Wunsch oder Hinweis der betroffenen Person, soweit dem keine gesetzlichen Aufbewahrungspflichten entgegenstehen. Die Gesamtheit der Mitarbeiter des für die Verarbeitung Verantwortlichen stehen der betroffenen Person in diesem Zusammenhang als Ansprechpartner zur Verfügung.

Kontaktmöglichkeit über die Internetseite

Die Internetseite enthält aufgrund von gesetzlichen Vorschriften Angaben, die eine schnelle elektronische Kontaktaufnahme zu unserem Unternehmen sowie eine unmittelbare Kommunikation mit uns ermöglichen, was ebenfalls eine allgemeine Adresse der sogenannten elektronischen Post (E-Mail-Adresse) umfasst. Sofern eine betroffene Person per E-Mail oder über ein Kontaktformular den Kontakt mit dem für die Verarbeitung Verantwortlichen aufnimmt, werden die von der betroffenen Person übermittelten personenbezogenen Daten automatisch gespeichert. Solche auf freiwilliger Basis von einer betroffenen Person an den für die Verarbeitung Verantwortlichen übermittelten personenbezogenen Daten werden für Zwecke der Bearbeitung oder der Kontaktaufnahme zur betroffenen Person gespeichert. Es erfolgt keine Weitergabe dieser personenbezogenen Daten an Dritte.

Kommentarfunktion im Blog auf der Internetseite

Wir bieten den Nutzern auf einem Blog, der sich auf der Internetseite des für die Verarbeitung Verantwortlichen befindet, die Möglichkeit, individuelle Kommentare zu einzelnen Blog-Beiträgen zu hinterlassen. Ein Blog ist ein auf einer Internetseite geführtes, in der Regel öffentlich einsehbares Portal, in welchem eine oder mehrere Personen, die Blogger oder Web-Blogger genannt werden, Artikel posten oder Gedanken in sogenannten Blogposts niederschreiben können. Die Blogposts können in der Regel von Dritten kommentiert werden.

Hinterlässt eine betroffene Person einen Kommentar in dem auf dieser Internetseite veröffentlichten Blog, werden neben den von der betroffenen Person hinterlassenen Kommentaren auch Angaben zum Zeitpunkt der Kommentareingabe sowie zu dem von der betroffenen Person gewählten Nutzernamen (Pseudonym) gespeichert und veröffentlicht. Ferner wird die vom Internet-Service-Provider (ISP) der betroffenen Person vergebene IP-Adresse mitprotokolliert. Diese Speicherung der IP-Adresse erfolgt aus Sicherheitsgründen und für den Fall, dass die betroffene Person durch einen abgegebenen Kommentar die Rechte Dritter verletzt oder rechtswidrige Inhalte postet. Die Speicherung dieser personenbezogenen Daten erfolgt daher im eigenen Interesse des für die Verarbeitung Verantwortlichen, damit sich dieser im Falle einer Rechtsverletzung gegebenenfalls exkulpieren könnte. Es erfolgt keine Weitergabe dieser erhobenen personenbezogenen Daten an Dritte, sofern eine solche Weitergabe nicht gesetzlich vorgeschrieben ist oder der Rechtsverteidigung des für die Verarbeitung Verantwortlichen dient.

Gravatar

Bei Kommentaren wird auf den Gravatar Service von Auttomatic zurückgegriffen. Gravatar gleicht Ihre Email-Adresse ab und bildet – sofern Sie dort registriert sind – Ihr Avatar-Bild neben dem Kommentar ab. Sollten Sie nicht registriert sein, wird kein Bild angezeigt. Zu beachten ist, dass alle registrierten WordPress-User automatisch auch bei Gravatar registriert sind. Details zu Gravatar: https://de.gravatar.com

Routinemäßige Löschung und Sperrung von personenbezogenen Daten

Der für die Verarbeitung Verantwortliche verarbeitet und speichert personenbezogene Daten der betroffenen Person nur für den Zeitraum, der zur Erreichung des Speicherungszwecks erforderlich ist oder sofern dies durch den Europäischen Richtlinien- und Verordnungsgeber oder einen anderen Gesetzgeber in Gesetzen oder Vorschriften, welchen der für die Verarbeitung Verantwortliche unterliegt, vorgesehen wurde.

Entfällt der Speicherungszweck oder läuft eine vom Europäischen Richtlinien- und Verordnungsgeber oder einem anderen zuständigen Gesetzgeber vorgeschriebene Speicherfrist ab, werden die personenbezogenen Daten routinemäßig und entsprechend den gesetzlichen Vorschriften gesperrt oder gelöscht.

Rechte der betroffenen Person

- a) Recht auf Bestätigung
- Jede betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber eingeräumte Recht, von dem für die Verarbeitung Verantwortlichen eine Bestätigung darüber zu verlangen, ob sie betreffende personenbezogene Daten verarbeitet werden. Möchte eine betroffene Person dieses Bestätigungsrecht in Anspruch nehmen, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden.
- b) Recht auf AuskunftJede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, jederzeit von dem für die Verarbeitung Verantwortlichen unentgeltliche Auskunft über die zu seiner Person gespeicherten personenbezogenen Daten und eine Kopie dieser Auskunft zu erhalten. Ferner hat der Europäische Richtlinien- und Verordnungsgeber der betroffenen Person Auskunft über folgende Informationen zugestanden:
- die Verarbeitungszwecke
- die Kategorien personenbezogener Daten, die verarbeitet werden
- die Empfänger oder Kategorien von Empfängern, gegenüber denen die personenbezogenen Daten offengelegt worden sind oder noch offengelegt werden, insbesondere bei Empfängern in Drittländern oder bei internationalen Organisationen
- falls möglich die geplante Dauer, für die die personenbezogenen Daten gespeichert werden, oder, falls dies nicht möglich ist, die Kriterien für die Festlegung dieser Dauer
- das Bestehen eines Rechts auf Berichtigung oder Löschung der sie betreffenden personenbezogenen Daten oder auf Einschränkung der Verarbeitung durch den Verantwortlichen oder eines Widerspruchsrechts gegen diese Verarbeitung
- das Bestehen eines Beschwerderechts bei einer Aufsichtsbehörde
- wenn die personenbezogenen Daten nicht bei der betroffenen Person erhoben werden: Alle verfügbaren Informationen über die Herkunft der Daten
- das Bestehen einer automatisierten Entscheidungsfindung einschließlich Profiling gemäß Artikel 22 Abs.1 und 4 DS-GVO und — zumindest in diesen Fällen — aussagekräftige Informationen über die involvierte Logik sowie die Tragweite und die angestrebten Auswirkungen einer derartigen Verarbeitung für die betroffene Person

Ferner steht der betroffenen Person ein Auskunftsrecht darüber zu, ob personenbezogene Daten an ein Drittland oder an eine internationale Organisation übermittelt wurden. Sofern dies der Fall ist, so steht der betroffenen Person im Übrigen das Recht zu, Auskunft über die geeigneten Garantien im Zusammenhang mit der Übermittlung zu erhalten.Möchte eine betroffene Person dieses Auskunftsrecht in Anspruch nehmen, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden.

- c) Recht auf Berichtigung
- Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, die unverzügliche Berichtigung sie betreffender unrichtiger personenbezogener Daten zu verlangen. Ferner steht der betroffenen Person das Recht zu, unter Berücksichtigung der Zwecke der Verarbeitung, die Vervollständigung unvollständiger personenbezogener Daten — auch mittels einer ergänzenden Erklärung — zu verlangen.
- Möchte eine betroffene Person dieses Berichtigungsrecht in Anspruch nehmen, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden.
- d) Recht auf Löschung (Recht auf Vergessen werden)Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, von dem Verantwortlichen zu verlangen, dass die sie betreffenden personenbezogenen Daten unverzüglich gelöscht werden, sofern einer der folgenden Gründe zutrifft und soweit die Verarbeitung nicht erforderlich ist:
- Die personenbezogenen Daten wurden für solche Zwecke erhoben oder auf sonstige Weise verarbeitet, für welche sie nicht mehr notwendig sind.
- Die betroffene Person widerruft ihre Einwilligung, auf die sich die Verarbeitung gemäß Art. 6 Abs. 1 Buchstabe a DS-GVO oder Art. 9 Abs. 2 Buchstabe a DS-GVO stützte, und es fehlt an einer anderweitigen Rechtsgrundlage für die Verarbeitung.
- Die betroffene Person legt gemäß Art. 21 Abs. 1 DS-GVO Widerspruch gegen die Verarbeitung ein, und esliegen keine vorrangigen berechtigten Gründe für die Verarbeitung vor, oder die betroffene Person legt gemäß Art. 21 Abs. 2 DS-GVO Widerspruch gegen die Verarbeitung ein.
- Die personenbezogenen Daten wurden unrechtmäßig verarbeitet.
- Die Löschung der personenbezogenen Daten ist zur Erfüllung einer rechtlichen Verpflichtung nach dem Unionsrecht oder dem Recht der Mitgliedstaaten erforderlich, dem der Verantwortliche unterliegt.
- Die personenbezogenen Daten wurden in Bezug auf angebotene Dienste der Informationsgesellschaft gemäß Art. 8 Abs. 1 DS-GVO erhoben.

Sofern einer der oben genannten Gründe zutrifft und eine betroffene Person die Löschung von personenbezogenen Daten, die gespeichert sind, veranlassen möchte, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden. Der Mitarbeiter wird veranlassen, dass dem Löschverlangen unverzüglich nachgekommen wird.Wurden die personenbezogenen Daten öffentlich gemacht und ist unser Unternehmen als Verantwortlicher gemäß Art. 17 Abs. 1 DS-GVO zur Löschung der personenbezogenen Daten verpflichtet, so trifft uns unter Berücksichtigung der verfügbaren Technologie und der Implementierungskosten angemessene Maßnahmen, auch technischer Art, um andere für die Datenverarbeitung Verantwortliche, welche die veröffentlichten personenbezogenen Daten verarbeiten, darüber in Kenntnis zu setzen, dass die betroffene Person von diesen anderen für die Datenverarbeitung Verantwortlichen die Löschung sämtlicherlinks zu diesen personenbezogenen Daten oder von Kopien oder Replikationen dieser personenbezogenen Daten verlangt hat, soweit die Verarbeitung nicht erforderlich ist. Der Mitarbeiter wird im Einzelfall das Notwendige veranlassen.

- e) Recht auf Einschränkung der VerarbeitungJede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, von dem Verantwortlichen die Einschränkung der Verarbeitung zu verlangen, wenn eine der folgenden Voraussetzungen gegeben ist:
- Die Richtigkeit der personenbezogenen Daten wird von der betroffenen Person bestritten, und zwar für eine Dauer, die es dem Verantwortlichen ermöglicht, die Richtigkeit der personenbezogenen Daten zu überprüfen.
- Die Verarbeitung ist unrechtmäßig, die betroffene Person lehnt die Löschung der personenbezogenen Daten ab und verlangt stattdessen die Einschränkung der Nutzung der personenbezogenen Daten.
- Der Verantwortliche benötigt die personenbezogenen Daten für die Zwecke der Verarbeitung nicht länger, die betroffene Person benötigt sie jedoch zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
- Die betroffene Person hat Widerspruch gegen die Verarbeitung gem. Art. 21 Abs. 1 DS-GVO eingelegt und es steht noch nicht fest, ob die berechtigten Gründe des Verantwortlichen gegenüber denen der betroffenen Person überwiegen.

Sofern eine der oben genannten Voraussetzungen gegeben ist und eine betroffene Person die Einschränkung von personenbezogenen Daten, die gespeichert sind, verlangen möchte, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden. Der Mitarbeiter wird die Einschränkung der Verarbeitung veranlassen.

- f) Recht auf Datenübertragbarkeit
- Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, die sie betreffenden personenbezogenen Daten, welche durch die betroffene Person einem Verantwortlichen bereitgestellt wurden, in einem strukturierten, gängigen und maschinenlesbaren Format zu erhalten. Sie hat außerdem das Recht, diese Daten einem anderen Verantwortlichen ohne Behinderung durch den Verantwortlichen, dem die personenbezogenen Daten bereitgestellt wurden, zu übermitteln, sofern die Verarbeitung auf der Einwilligung gemäß Art. 6 Abs. 1 Buchstabe a DS-GVO oder Art. 9 Abs. 2 Buchstabe a DS-GVO oder auf einem Vertrag gemäß Art. 6 Abs. 1 Buchstabe b DS-GVO beruht und die Verarbeitung mithilfe automatisierter Verfahren erfolgt, sofern die Verarbeitung nicht für die Wahrnehmung einer Aufgabe erforderlich ist, die im öffentlichen Interesseliegt oder in Ausübung öffentlicher Gewalt erfolgt, welche dem Verantwortlichen übertragen wurde.
- Ferner hat die betroffene Person bei der Ausübung ihres Rechts auf Datenübertragbarkeit gemäß Art. 20 Abs. 1 DS-GVO das Recht, zu erwirken, dass die personenbezogenen Daten direkt von einem Verantwortlichen an einen anderen Verantwortlichen übermittelt werden, soweit dies technisch machbar ist und sofern hiervon nicht die Rechte und Freiheiten anderer Personen beeinträchtigt werden.
- Zur Geltendmachung des Rechts auf Datenübertragbarkeit kann sich die betroffene Person jederzeit an uns wenden.
- g) Recht auf Widerspruch
- Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, aus Gründen, die sich aus ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung sie betreffender personenbezogener Daten, die aufgrund von Art. 6 Abs. 1 Buchstaben e oder f DS-GVO erfolgt, Widerspruch einzulegen. Dies gilt auch für ein auf diese Bestimmungen gestütztes Profiling.
- Wir verarbeiten die personenbezogenen Daten im Falle des Widerspruchs nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe für die Verarbeitung nachweisen, die den Interessen, Rechten und Freiheiten der betroffenen Person überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
- Verarbeiten wir personenbezogene Daten, um Direktwerbung zu betreiben, so hat die betroffene Person das Recht, jederzeit Widerspruch gegen die Verarbeitung der personenbezogenen Daten zum Zwecke derartiger Werbung einzulegen. Dies gilt auch für das Profiling, soweit es mit solcher Direktwerbung in Verbindung steht. Widerspricht die betroffene Person gegenüber der Verarbeitung für Zwecke der Direktwerbung, so werden wir die personenbezogenen Daten nicht mehr für diese Zwecke verarbeiten.
- Zudem hat die betroffene Person das Recht, aus Gründen, die sich aus ihrer besonderen Situation ergeben, gegen die sie betreffende Verarbeitung personenbezogener Daten, die zu wissenschaftlichen oder historischen Forschungszwecken oder zu statistischen Zwecken gemäß Art. 89 Abs. 1 DS-GVO erfolgen, Widerspruch einzulegen, es sei denn, eine solche Verarbeitung ist zur Erfüllung einer im öffentlichen Interesseliegenden Aufgabe erforderlich.
- Zur Ausübung des Rechts auf Widerspruch kann sich die betroffene Person direkt an jeden Mitarbeiter wenden. Der betroffenen Person steht es ferner frei, im Zusammenhang mit der Nutzung von Diensten der Informationsgesellschaft, ungeachtet der Richtlinie 2002/58/EG, ihr Widerspruchsrecht mittels automatisierter Verfahren auszuüben, bei denen technische Spezifikationen verwendet werden.
- h) Automatisierte Entscheidungen im Einzelfall einschließlich Profiling
- Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, nicht einer ausschließlich auf einer automatisierten Verarbeitung — einschließlich Profiling — beruhenden Entscheidung unterworfen zu werden, die ihr gegenüber rechtliche Wirkung entfaltet oder sie in ähnlicher Weise erheblich beeinträchtigt, sofern die Entscheidung (1) nicht für den Abschluss oder die Erfüllung eines Vertrags zwischen der betroffenen Person und dem Verantwortlichen erforderlich ist, oder (2) aufgrund von Rechtsvorschriften der Union oder der Mitgliedstaaten, denen der Verantwortliche unterliegt, zulässig ist und diese Rechtsvorschriften angemessene Maßnahmen zur Wahrung der Rechte und Freiheiten sowie der berechtigten Interessen der betroffenen Person enthalten oder (3) mit ausdrücklicher Einwilligung der betroffenen Person erfolgt.
- Ist die Entscheidung (1) für den Abschluss oder die Erfüllung eines Vertrags zwischen der betroffenen Person und dem Verantwortlichen erforderlich oder (2) erfolgt sie mit ausdrücklicher Einwilligung der betroffenen Person, triffen wir die angemessene Maßnahmen, um die Rechte und Freiheiten sowie die berechtigten Interessen der betroffenen Person zu wahren, wozu mindestens das Recht auf Erwirkung des Eingreifens einer Person seitens des Verantwortlichen, auf Darlegung des eigenen Standpunkts und auf Anfechtung der Entscheidung gehört.
- Möchte die betroffene Person Rechte mit Bezug auf automatisierte Entscheidungen geltend machen, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden.
- i) Recht auf Widerruf einer datenschutzrechtlichen Einwilligung
- Jede von der Verarbeitung personenbezogener Daten betroffene Person hat das vom Europäischen Richtlinien- und Verordnungsgeber gewährte Recht, eine Einwilligung zur Verarbeitung personenbezogener Daten jederzeit zu widerrufen.
- Möchte die betroffene Person ihr Recht auf Widerruf einer Einwilligung geltend machen, kann sie sich hierzu jederzeit an einen Mitarbeiter des für die Verarbeitung Verantwortlichen wenden.

Rechtsgrundlage der Verarbeitung

Art. 6 Ilit. a DS-GVO dient unserem Unternehmen als Rechtsgrundlage für Verarbeitungsvorgänge, bei denen wir eine Einwilligung für einen bestimmten Verarbeitungszweck einholen. Ist die Verarbeitung personenbezogener Daten zur Erfüllung eines Vertrags, dessen Vertragspartei die betroffene Person ist, erforderlich, wie dies beispielsweise bei Verarbeitungsvorgängen der Fall ist, die für einelieferung von Waren oder die Erbringung einer sonstigen Leistung oder Gegenleistung notwendig sind, so beruht die Verarbeitung auf Art. 6 Ilit. b DS-GVO. Gleiches gilt für solche Verarbeitungsvorgänge die zur Durchführung vorvertraglicher Maßnahmen erforderlich sind, etwa in Fällen von Anfragen zur unseren Produkten oder Leistungen. Unterliegt unser Unternehmen einer rechtlichen Verpflichtung durch welche eine Verarbeitung von personenbezogenen Daten erforderlich wird, wie beispielsweise zur Erfüllung steuerlicher Pflichten, so basiert die Verarbeitung auf Art. 6 Ilit. c DS-GVO. In seltenen Fällen könnte die Verarbeitung von personenbezogenen Daten erforderlich werden, um lebenswichtige Interessen der betroffenen Person oder einer anderen natürlichen Person zu schützen. Dies wäre beispielsweise der Fall, wenn ein Besucher in unserem Betrieb verletzt werden würde und daraufhin sein Name, sein Alter, seine Krankenkassendaten oder sonstige lebenswichtige Informationen an einen Arzt, ein Krankenhaus oder sonstige Dritte weitergegeben werden müssten. Dann würde die Verarbeitung auf Art. 6 Ilit. d DS-GVO beruhen.

Letztlich könnten Verarbeitungsvorgänge auf Art. 6 Ilit. f DS-GVO beruhen. Auf dieser Rechtsgrundlage basieren Verarbeitungsvorgänge, die von keiner der vorgenannten Rechtsgrundlagen erfasst werden, wenn die Verarbeitung zur Wahrung eines berechtigten Interesses unseres Unternehmens oder eines Dritten erforderlich ist, sofern die Interessen, Grundrechte und Grundfreiheiten des Betroffenen nicht überwiegen. Solche Verarbeitungsvorgänge sind uns insbesondere deshalb gestattet, weil sie durch den Europäischen Gesetzgeber besonders erwähnt wurden. Er vertrat insoweit die Auffassung, dass ein berechtigtes Interesse anzunehmen sein könnte, wenn die betroffene Person ein Kunde des Verantwortlichen ist (Erwägungsgrund 47 Satz 2 DS-GVO).

Berechtigte Interessen an der Verarbeitung, die von dem Verantwortlichen oder einem Dritten verfolgt werden

Basiert die Verarbeitung personenbezogener Daten auf Artikel 6 Ilit. f DS-GVO ist unser berechtigtes Interesse die Durchführung unserer Geschäftstätigkeit zugunsten des Wohlergehens all unserer Mitarbeiter und unserer Anteilseigner.

Dauer, für die die personenbezogenen Daten gespeichert werden

Das Kriterium für die Dauer der Speicherung von personenbezogenen Daten ist die jeweilige gesetzliche Aufbewahrungsfrist. Nach Ablauf der Frist werden die entsprechenden Daten routinemäßig gelöscht, sofern sie nicht mehr zur Vertragserfüllung oder Vertragsanbahnung erforderlich sind.

Gesetzliche oder vertragliche Vorschriften zur Bereitstellung der personenbezogenen Daten; Erforderlichkeit für den Vertragsabschluss; Verpflichtung der betroffenen Person, die personenbezogenen Daten bereitzustellen; mögliche Folgen der Nichtbereitstellung

Wir klären Sie darüber auf, dass die Bereitstellung personenbezogener Daten zum Teil gesetzlich vorgeschrieben ist (z.B. Steuervorschriften) oder sich auch aus vertraglichen Regelungen (z.B. Angaben zum Vertragspartner) ergeben kann.

Mitunter kann es zu einem Vertragsschluss erforderlich sein, dass eine betroffene Person uns personenbezogene Daten zur Verfügung stellt, die in der Folge durch uns verarbeitet werden müssen. Die betroffene Person ist beispielsweise verpflichtet uns personenbezogene Daten bereitzustellen, wenn unser Unternehmen mit ihr einen Vertrag abschließt. Eine Nichtbereitstellung der personenbezogenen Daten hätte zur Folge, dass der Vertrag mit dem Betroffenen nicht geschlossen werden könnte.

Vor einer Bereitstellung personenbezogener Daten durch den Betroffenen muss sich der Betroffene an einen unserer Mitarbeiter wenden. Unser Mitarbeiter klärt den Betroffenen einzelfallbezogen darüber auf, ob die Bereitstellung der personenbezogenen Daten gesetzlich oder vertraglich vorgeschrieben oder für den Vertragsabschluss erforderlich ist, ob eine Verpflichtung besteht, die personenbezogenen Daten bereitzustellen, und welche Folgen die Nichtbereitstellung der personenbezogenen Daten hätte.

Bestehen einer automatisierten Entscheidungsfindung

Als verantwortungsbewusstes Unternehmen verzichten wir auf eine automatische Entscheidungsfindung oder ein Profiling.

Allgemeine Cookies

Die nachfolgenden Cookies zählen zu den technisch notwendigen Cookies.

Cookies von WordPress

NameZweckGültigkeitwordpress_test_cookieDieses Cookie ermittelt, ob die Verwendung von Cookies im Browser deaktiviert wurde. Speicherdauer: Bis zum Ende der Browsersitzung (wird beim Schließen Ihres Internet-Browsers gelöscht).SessionPHPSESSIDDieses Cookie speichert Ihre aktuelle Sitzung mit Bezug auf PHP-Anwendungen und gewährleistet so, dass alle Funktionen dieser Website, die auf der PHP-Programmiersprache basieren, vollständig angezeigt werden können. Speicherdauer: Bis zum Ende der Browsersitzung (wird beim Schließen Ihres Internet-Browsers gelöscht).Sessionwordpress_akm_mobileDiese Cookies werden nur für den Verwaltungsbereich von WordPress verwendet.1 Jahrwordpress_logged_in_akm_mobileDiese Cookies werden nur für den Verwaltungsbereich von WordPress verwendet und gelten für andere Seitenbesucher nicht.Sessionwp-settings-akm_mobileDiese Cookies werden nur für den Verwaltungsbereich von WordPress verwendet und gelten für andere Seitenbesucher nicht.Sessionwp-settings-time-akm_mobileDiese Cookies werden nur für den Verwaltungsbereich von WordPress verwendet und gelten für andere Seitenbesucher nicht.Sessionabwird für A/B-Tests von neuen Funktionen verwendet.Sessionakm_mobilespeichert, ob der Besucher die Mobilversion einer Website angezeigt bekommen möchte.1 Tag

Cookies von DSGVO AIO for WordPress

NameZweckGültigkeitdsgvoaioDieser LocalStorage Key / Wert speichert welchen Diensten der Nutzer zugestimmt hat oder nicht.variabel_uniqueuidDieser LocalStorage Key / Wert speichert eine generierte ID sodass die Opt-in / Opt-out Aktionen des Nutzers dokumentiert werden können. Die ID wird anonymisiert gespeichert.variabeldsgvoaio_createDieser LocalStorage Key / Wert speichert den Zeitpunkt an dem _uniqueuid generiert wurde.variabeldsgvoaio_vgwort_disableDieser LocalStorage Key / Wert speichert ob der Dienst VG Wort Standard zugelassen wird oder nicht (Einstellung des Seitenbetreibers).variabeldsgvoaio_ga_disableDieser LocalStorage Key / Wert speichert ob der Dienst Google Analytics Standard zugelassen wird oder nicht (Einstellung des Seitenbetreibers).variabel

Facebook-Pixel

Unsere Website nutzt zur Konversionsmessung das Besucheraktions-Pixel von Facebook, Facebook Inc., 1601 S. California Ave, Palo Alto, CA 94304, USA ("Facebook").

Mit Hilfe des Facebook-Pixel kann das Verhalten der Seitenbesucher nachverfolgt werden, nachdem diese durch Klick auf eine Facebook-Werbeanzeige auf unsere Website weitergeleitet wurden. Dadurch können die Wirksamkeit der Facebook-Werbeanzeigen für statistische und Marktforschungszwecke ausgewertet und zukünftige Werbemaßnahmen optimiert werden.

Die erhobenen Daten sind für uns als Betreiber dieser Website anonym, wir können keine Rückschlüsse auf die Identität der Nutzer ziehen. Die Daten werden aber von Facebook gespeichert und verarbeitet, sodass eine Verbindung zum jeweiligen Nutzerprofil möglich ist und Facebook die Daten für eigene Werbezwecke, entsprechend der Facebook-Datenverwendungsrichtlinie verwenden kann. Dadurch kann Facebook das Schalten von Werbeanzeigen auf Seiten von Facebook sowie außerhalb von Facebook ermöglichen. Diese Verwendung der Daten kann von uns als Seitenbetreiber nicht beeinflusst werden.

In den Datenschutzhinweisen von Facebook finden Sie weitere Hinweise zum Schutz Ihrer Privatsphäre: https://www.facebook.com/about/privacy/.

Sie können außerdem die Remarketing-Funktion "Custom Audiences" im Bereich Einstellungen für Werbeanzeigen unter https://www.facebook.com/ads/preferences/?entry_product=ad_settings_screen deaktivieren. Dazu müssen Sie bei Facebook angemeldet sein.

Wenn Sie kein Facebook Konto besitzen, können Sie nutzungsbasierte Werbung von Facebook auf der Website der European Interactive Digital Advertising Alliance deaktivieren: http://www.youronlinechoices.com/de/praferenzmanagement/.

Cookies von Facebook Pixel

NameZweckGültigkeitact, c_user, datr, fr, pl, presence, sd, wd, xsFacebook setzt verschiedene Cookies zur Identifizierungssitzung und Analyse. Diese werden verwendet um zu erkennen ob Sie als Nutzer bei Facebook eingeloggt sind, zu Trackingzwecken und von welcher URL die Share/ Like Funktion verwendet wird.variabel

Google Analytics

Diese Website nutzt verschiedene Dienste des Anbieters Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Die einzelnen Dienste werden im nachfolgenden Abschnitt näher dargstellt.

Grundsätzlich verfolgen wir mit dem Einsatz der nachstehenden Dienste und damit verbunden der Erhebung personenbezogener Daten (insbes. der IP-Adresse) ein berechtigtes Interesse, das Angebot auf unserer Website ansprechend darzustellen, zu analysieren, zu verbessern und mögliche Werbung auf Ihre Bedürfnisse anzupassen (Art.6 Abs. 1 lit. f DSGVO).

Google Analytics verwendet sogenannte "Cookies" (s. auch 3.1 „Cookies"). Sie werden auf Ihrem Computer gespeichert und ermöglichen eine Analyse der Benutzung der Website durch Sie. Die durch das Cookie erzeugten Informationen über Ihre Benutzung dieser Website werden in der Regel an einen Server von Google in den USA übertragen und dort gespeichert.

IP Anonymisierung

Wir haben auf dieser Website die Funktion IP-Anonymisierung aktiviert. Dadurch wird Ihre IP-Adresse von Google innerhalb von Mitgliedstaaten der Europäischen Union oder in anderen Vertragsstaaten des Abkommens über den Europäischen Wirtschaftsraum vor der Übermittlung in die USA gekürzt. Im Auftrag des Betreibers dieser Website wird Google diese Informationen benutzen, um Ihre Nutzung der Website auszuwerten, um Reports über die Websiteaktivitäten zusammenzustellen und um weitere mit der Websitenutzung und der Internetnutzung verbundene Dienstleistungen gegenüber dem Websitebetreiber zu erbringen. Die im Rahmen von Google Analytics von Ihrem Browser übermittelte IP-Adresse wird nicht mit anderen Daten von Google zusammengeführt.

Widerspruch gegen Datenerfassung

Sie können die Speicherung der Cookies durch eine entsprechende Einstellung Ihrer Browser-Software verhindern; wir weisen Sie jedoch darauf hin, dass Sie in diesem Fall gegebenenfalls nicht alle Funktionen dieser Website vollumfänglich nutzen können. Sie können darüber hinaus die Erfassung der durch den Cookie erzeugten und auf Ihre Nutzung der Website bezogenen Daten (inkl. Ihrer IP-Adresse) an Google sowie die Verarbeitung dieser Daten durch Google verhindern, indem Sie das unter dem folgenden Link verfügbare Browser-Plugin herunterladen und installieren: https://tools.google.com/dlpage/gaoptout?hl=de.

Mehr Informationen zum Umgang mit Nutzerdaten bei Google Analytics finden Sie in der Datenschutzerklärung von Google: https://support.google.com/analytics/answer/6004245?hl=de.

Auftragsverarbeitung

Wir haben zur Nutzung von Google Analytics einen Vertrag zur Auftragsverarbeitung abgeschlossen und setzen die strengen Vorgaben der deutschen Datenschutzbehörden bei der Nutzung der Dienste vollständig um.

Demografische Merkmale bei Google Analytics

Diese Website nutzt die Funktion "demografische Merkmale" von Google Analytics. Dadurch können Berichte erstellt werden, die Aussagen zu Alter, Geschlecht und Interessen der Seitenbesucher enthalten. Diese Daten stammen aus interessenbezogener Werbung von Google sowie aus Besucherdaten von Drittanbietern. Diese Daten können keiner bestimmten Person zugeordnet werden. Sie können diese Funktion jederzeit über die Anzeigeneinstellungen in Ihrem Google-Konto deaktivieren oder die Erfassung Ihrer Daten durch Google Analytics wie im vorherigen Absatz dargestellt generell untersagen.

Cookies von Google Analytics

- _ga

Dient zur Unterscheidung der Webseitenbesucher.

Speicherdauer: 2 Jahre

- _gid

Ebenfalls zur Unterscheidung der Webseitenbesucher.

Speicherdauer: 24 Stunden

- gat_gtag_UA

Wird zur Drosselung der Anforderungsrate eingesetzt. Wenn Google Analytics über den Google Tag Manager bereitgestellt wird, erhält das Cookie den Namen dc_gtm.

Speicherdauer: 1 Minute

- dc_gtm

Dient zur Überwachung der Anzahl an Google-Analytics-Serveranfragen.

Speicherdauer: 1 Minute

- AMP_TOKEN

Enthält einen Token-Code zum Auslesen einer Client-ID aus dem AMP-Client-ID-Service. Ermöglicht den Abgleich von Nutzern zwischen AMP- und Nicht-AMP-Inhalten.

Speicherdauer: 30 Sekunden bis 1 Jahr

- _gat

Wird zur Überwachung der Anzahl von Serveranfragen bei Nutzung von Google Tag Manager verwendet.

Speicherdauer: 1 Minute

- gac

Enthält Informationen zu Marketingkampagnen des Benutzers. Wird mit Google Ads geteilt, wenn Google Ads und Google Analytics verknüpft sind.

Speicherdauer: 90 Tage

- __utma

ID zur Identifizierung von Benutzern und Sitzungen.

Speicherdauer: 2 Jahre

- __utmt

Dient zur Begrenzung der Anzahl an Serveranfragen.

Speicherdauer: 10 Minuten

- __utmb

Zur Unterscheidung zwischen neuen Sitzungen und Besuchen. Wird jedes Mal aktualisiert, wenn Daten an den Analytics-Server gesendet werden.

Speicherdauer: 30 Minuten

- __utmc

Nur in älteren Urchin-Versionen von Analytics genutzt, zur Unterscheidung neuer Sitzungen am Ende einer Sitzung.

Speicherdauer: Session

- __utmz

Enthält Informationen über die Quelle oder Kampagne, die den Nutzer auf die Website geführt hat. Wird beim Laden des GA.js-Skripts gesetzt und bei jeder Datenübermittlung aktualisiert.

Speicherdauer: 6 Monate

- __utmv

Enthält benutzerdefinierte Informationen, die mit der Methode _setCustomVar in Google Analytics gesetzt werden. Aktualisiert sich bei jeder Datenübertragung.

Speicherdauer: 2 Jahre

- __utmx

Wird verwendet, um zu bestimmen, ob ein Benutzer in einen A/B- oder multivariaten Test einbezogen wird.

Speicherdauer: 18 Monate

- __utmxx

Bestimmt, wann ein A/B- oder multivariater Test endet.

Speicherdauer: 18 Monate

LinkedIn

Innerhalb unseres Onlineangebotes können Funktionen und Inhalte des Dienstes LinkedIn eingebunden, angeboten durch die LinkedIn AG, Dammtorstraße 29-32, 20354 Hamburg, Deutschland. Hierzu können z.B. Inhalte wie Bilder, Videos oder Texte und Schaltflächen gehören, mit denen Nutzer Ihr Gefallen betreffend die Inhalte kundtun, den Verfassern der Inhalte oder unsere Beiträge abonnieren können.

Sofern die Nutzer Mitglieder der Plattform LinkedIn sind, kann LinkedIn den Aufruf der o.g. Inhalte und Funktionen den dortigen Profilen der Nutzer zuordnen. Datenschutzerklärung von LinkedIn: https://www.linkedin.com/legal/privacy-policy..

LinkedIn ist unter dem Privacy-Shield-Abkommen zertifiziert und bietet hierdurch eine Garantie, das europäische Datenschutzrecht einzuhalten (https://www.privacyshield.gov/participant?id=a2zt0000000L0UZAA0&status=Active).

Datenschutzerklärung: https://twitter.com/de/privacy, Opt-Out: https://www.linkedin.com/psettings/guest-controls/retargeting-opt-out.

Cookies von LinkedIn

- lidc

Verwendet vom Social-Networking-Dienst LinkedIn zur Verfolgung der Nutzung eingebetteter Dienste.

Speicherdauer: Session

- bcookie

Wird von LinkedIn eingesetzt, um die Nutzung eingebetteter Dienste nachzuverfolgen.

Speicherdauer: 2 Jahre

- bscookie

Ebenfalls von LinkedIn zur Verfolgung der Nutzung eingebetteter Dienste verwendet.

Speicherdauer: 2 Jahre

- BizoID

Dient der Analyse von LinkedIn-Anzeigen.

Speicherdauer: 179 Tage

- UserMatchHistory

Ebenfalls für LinkedIn-Anzeigenanalysen eingesetzt.

Speicherdauer: 179 Tage

- trkCode

Unterstützt die Funktionalität der LinkedIn-Einladungspanels („Follow Us“).

Speicherdauer: 1 Jahr

- trkInfo

Unterstützt ebenfalls die Funktionalität der Einladungspanels („Follow Us“).

Speicherdauer: 1 Jahr

- li_oatml

Sammelt Informationen darüber, wie Besucher unsere Website nutzen.

Speicherdauer: 30 Tage

- liap

Cookie für die Anmeldung mit LinkedIn und/oder zur Ermöglichung der LinkedIn-Folgefunktion.

Speicherdauer: 90 Tage

- lissc

Ebenfalls für die Anmeldung und Folgefunktion von LinkedIn eingesetzt.

Speicherdauer: 1 Jahr

- spectroscopyId

Wird von LinkedIn zu Werbezwecken gesetzt, unter anderem zur Nachverfolgung von Besuchern, zur Anzeige relevanterer Werbung, zur Nutzung der Funktionen „Bewerben mit LinkedIn“ oder „Anmelden mit LinkedIn“ sowie zur Erhebung von Informationen über die Website-Nutzung.

Speicherdauer: Session$rechtstext$, '2026-10-30 00:00 Europe/Berlin'),
  ('widerruf', '3.1', $rechtstext$Für Verbraucherinnen und Verbraucher gilt:

Widerrufsbelehrung

Widerrufsrecht

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.

Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (Investiere Dich Frei GmbH, Hauptstraße 28, 30982 Pattensen, Telefon: 05069-4399955, E-Mail: service@investieredichfrei.de) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Sie können Ihr Widerrufsrecht auch online unter https://www.investieredichfrei.de/vertrag-widerrufen ausüben. Wenn Sie diese Online-Funktion nutzen, übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

Folgen des Widerrufs

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.

Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.

Ende der Widerrufsbelehrung

Muster-Widerrufsformular

(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)

An Investiere Dich Frei GmbH, Hauptstraße 28, 30982 Pattensen, E-Mail: service@investieredichfrei.de:
Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)
Bestellt am (*)/erhalten am (*)
Name des/der Verbraucher(s)
Anschrift des/der Verbraucher(s)
Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)
Datum
(*) Unzutreffendes streichen.

Es gelten unsere AGB: investieredichfrei.de/rechtliches/allgemeine-geschaeftsbedingungen$rechtstext$, '2026-10-30 00:00 Europe/Berlin');
