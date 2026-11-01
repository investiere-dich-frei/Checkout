-- 0031 Kurszuordnung für Produkte, die nur im neuen System angelegt werden.
--
-- n8n schaltet Kurszugang (LearningSuite) und HubSpot-Deal über die Thrivecart-Produktnummer frei
-- (Tabelle tc_products in Supabase). Neue Produkte haben keine. Mit access_like_product_id gilt für
-- sie dieselbe Zuordnung wie für ein bestehendes Produkt, z. B. „Kurszugang wie Masterclass“.

alter table app.products
  add column access_like_product_id uuid references app.products (id),
  add constraint products_access_like_not_self check (access_like_product_id is null or access_like_product_id <> id);
