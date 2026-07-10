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

-- Demo Supabase Auth user (dev only). Password: 'demo-password'
-- NOTE: confirmation_token/recovery_token/email_change_token_new/email_change
-- must be '' (not NULL). GoTrue scans them into non-nullable Go strings, and a
-- NULL there yields "Database error querying schema" on sign-in.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'demo@tabletree.test',
        crypt('demo-password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000aa',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"demo@tabletree.test"}'::jsonb,
        'email', now(), now(), now())
on conflict do nothing;

-- Demo booking (steps 1-6 assumed done; stripe fields filled by seed_stripe.ts)
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa',
        'Demo Customer', 'demo@tabletree.test', now() + interval '1 day', 500,
        'demo-redeem-01', 'pending')
on conflict (id) do nothing;
