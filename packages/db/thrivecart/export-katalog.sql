-- Export des Thrivecart-Produktkatalogs aus dem Supabase-Spiegel
-- (Projekt „Investiere.Dich.Frei“), nur lesend.
-- Ergebnis: eine JSON-Zeile im Format von src/thrivecart-import.ts.
--
-- Quellen:
--   tc_products         Produkte mit Status und Zuordnungen (HubSpot, LearningSuite)
--   kl_tc_rohdaten      Produktdaten aus der Thrivecart-API (Slug, Status, Funnels)
--   kl_tc_optionen_ist  Preisoptionen, wie sie der Checkout aktuell anbietet
--   manual_order_tax    Steuersatz je Produkt und Land, abgeleitet aus Bestellungen
select json_build_object(
  'format', 'idf-thrivecart-katalog/1',
  'exported_at', now(),
  'source', 'supabase:tc_products,kl_tc_rohdaten,kl_tc_optionen_ist,manual_order_tax',
  'products', coalesce(json_agg(prod order by (prod->>'thrivecart_product_id')::bigint), '[]')
)
from (
  select json_build_object(
    'thrivecart_product_id', p.id,
    'name', p.name,
    'label', coalesce(p.label, r.raw->>'label'),
    'slug', r.raw->>'slug',
    'status', coalesce(r.raw->>'statusString',
                       case p.status when '1' then 'test' when '2' then 'live' when '3' then 'disabled' end,
                       'unbekannt'),
    'currency', coalesce(r.raw->>'payment_currency', 'EUR'),
    'upsell_ids', coalesce(r.raw->'upsell_ids', '[]'),
    'downsell_ids', coalesce(r.raw->'downsell_ids', '[]'),
    'refs', jsonb_strip_nulls(jsonb_build_object(
      'hubspot_product', p.hs_product,
      'learningsuite_course', p.ls_bundle_kurs,
      'learningsuite_livecalls', p.ls_bundle_livecalls,
      'learningsuite_recordings', p.ls_bundle_recordings,
      'learningsuite_extra', p.ls_bundle_zusatz,
      'access_months_course', p.access_months_course,
      'access_months_recordings', p.access_months_recordings
    )),
    'tax', (
      select json_agg(json_build_object(
        'country', t.country, 'rate', t.vat_rate, 'exempt_reason', t.exempt_reason, 'source', t.quelle
      ) order by t.country)
      from manual_order_tax t where t.product_id = p.id
    ),
    'options', coalesce((
      select json_agg(json_build_object(
        'option_id', o.option_id,
        'name', o.option_name,
        'mode', o.modus,
        'first_payment', o.erste_zahlung,
        'rebills', o.rebills,
        'recurring_payment', o.folgerate,
        'trial_days', case when o.probezeit then o.probezeit_tage end,
        'seen_at', o.zuletzt_gesehen
      ) order by o.option_id)
      from kl_tc_optionen_ist o where o.product_id = p.id
    ), '[]')
  )::jsonb as prod
  from tc_products p
  left join kl_tc_rohdaten r on r.product_id = p.id
) x;
