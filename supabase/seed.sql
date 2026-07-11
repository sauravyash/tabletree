insert into app_config (key, value) values
  ('floral_purchase_enabled', 'false'::jsonb),
  ('pricing_mode', '"placeholder"'::jsonb);

-- Products
insert into products (id, name, slug, description, active) values
  ('11111111-0000-0000-0000-000000000001', 'Table Tree', 'table-tree',
   'A single statement flower arranged in a coffee cup, with foliage that scales by size.', true),
  ('11111111-0000-0000-0000-000000000002', 'Living Room Box Bouquet', 'box-bouquet',
   'A larger box-format bouquet for living spaces.', true);

-- Table Tree variants (1 flower always; foliage varies). price_cents null (placeholder).
insert into product_variants (id, product_id, size, flower_count, foliage_level, price_cents, active) values
  ('22222222-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'S', 1, 'slight', null, true),
  ('22222222-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-000000000001', 'M', 1, 'some',   null, true),
  ('22222222-0000-0000-0000-0000000000a3', '11111111-0000-0000-0000-000000000001', 'L', 1, 'lots',   null, true);

-- Box Bouquet variants
insert into product_variants (id, product_id, size, flower_count, foliage_level, price_cents, active) values
  ('22222222-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002', 'MD', 3, 'appropriate',      null, true),
  ('22222222-0000-0000-0000-0000000000b2', '11111111-0000-0000-0000-000000000002', 'LG', 5, 'appropriate_lots', null, true);

-- Handle options for Box variants only
insert into variant_options (variant_id, option_key, option_value) values
  ('22222222-0000-0000-0000-0000000000b1', 'handle', 'with'),
  ('22222222-0000-0000-0000-0000000000b1', 'handle', 'without'),
  ('22222222-0000-0000-0000-0000000000b2', 'handle', 'with'),
  ('22222222-0000-0000-0000-0000000000b2', 'handle', 'without');
