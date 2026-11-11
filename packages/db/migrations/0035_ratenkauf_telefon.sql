-- 0035 Telefonnummer für die Europäische Standardinformation (Pflichtangabe zum Kreditgeber).
-- Nummer wie im Impressum der Homepage, Entscheidung Christian vom 11.11.2026.
-- Nur setzen, wenn noch keine eingetragen ist; danach in der Verwaltung unter Ratenprüfung änderbar.

select set_config('app.actor', 'system:migration-0035', true);

update app.credit_settings
   set contact_phone = '05069 4399955', updated_at = now(), updated_by = 'system:migration-0035'
 where contact_phone is null;
