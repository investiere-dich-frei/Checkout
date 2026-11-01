-- 0024 BIC zur Bankverbindung der Investiere Dich Frei GmbH.
--
-- In den n8n-Einstellungen war keine BIC hinterlegt. Christian hat am 01.11.2026 die
-- Kontodaten bestätigt (Hannoversche Volksbank, BLZ 25190001); die BIC dazu ist
-- VOHADE2HXXX. Gilt nur für neu ausgestellte Rechnungen, bestehende bleiben unverändert.

select set_config('app.actor', 'system:migration-0024', true);

update app.companies set bic = 'VOHADE2HXXX'
 where legal_name = 'Investiere Dich Frei GmbH'
   and iban = 'DE96251900010438090800'
   and bic is null;
