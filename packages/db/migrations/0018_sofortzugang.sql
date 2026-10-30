-- 0018 Sofortzugang ohne Sofortstart-Erklärung, wie in Thrivecart.
--
-- SOP CS-009 nimmt Masterclass Essential (Thrivecart 166) vom Sofortstart-Häkchen aus;
-- der n8n-Ablauf „ThriveCart Webhook“ schaltet sie immer am Kauftag frei. Produkte mit
-- immediate_access zeigen deshalb kein Häkchen, der Zugang beginnt am Kauftag.

alter table app.products
  add column immediate_access boolean not null default false;

select set_config('app.actor', 'system:migration-0018', true);

update app.products set immediate_access = true where thrivecart_product_id = 166;
