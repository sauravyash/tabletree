-- Test fixtures for the staff-role + card-save work: extra auth users, a few
-- bookings across different owners, and role assignments. NOT part of the default
-- seed (seed.sql stays minimal). Idempotent — safe to re-run. Test-only creds.
--
-- Auth users are inserted via SQL (same pattern as seed.sql's demo user): the
-- confirmation/recovery/email_change_token* columns must be '' (not NULL) or
-- GoTrue throws "Database error querying schema" on sign-in.

-- ---------------------------------------------------------------- customers
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@tabletree.test',
   crypt('test-password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bob@tabletree.test',
   crypt('test-password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carol@tabletree.test',
   crypt('test-password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''),
  -- ------------------------------------------------------------- staff / admin
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff@tabletree.test',
   crypt('staff-password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@tabletree.test',
   crypt('admin-password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1',
   '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"alice@tabletree.test"}'::jsonb, 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2',
   '{"sub":"00000000-0000-0000-0000-0000000000c2","email":"bob@tabletree.test"}'::jsonb, 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3',
   '{"sub":"00000000-0000-0000-0000-0000000000c3","email":"carol@tabletree.test"}'::jsonb, 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1',
   '{"sub":"00000000-0000-0000-0000-0000000000f1","email":"staff@tabletree.test"}'::jsonb, 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2',
   '{"sub":"00000000-0000-0000-0000-0000000000f2","email":"admin@tabletree.test"}'::jsonb, 'email', now(), now(), now())
on conflict do nothing;

-- ---------------------------------------------------------------- role grants
insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'staff'),
  ('00000000-0000-0000-0000-0000000000f2', 'admin')
on conflict do nothing;

-- ---------------------------------------------------------------- bookings
-- #2 alice: pending, no saved card (exercises the card-save flow).
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1',
        'Alice Example', 'alice@tabletree.test', now() + interval '1 day', 650,
        'test-redeem-02', 'pending')
on conflict (id) do nothing;

-- #3 bob: pending, no saved card.
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c2',
        'Bob Example', 'bob@tabletree.test', now() + interval '2 day', 750,
        'test-redeem-03', 'pending')
on conflict (id) do nothing;

-- #4 carol: already delivered (exercises the staff pending-list filter). Fake
-- stripe ids/pi so it looks like a completed charge without touching Stripe.
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      stripe_customer_id, stripe_payment_method_id, payment_intent_id,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c3',
        'Carol Example', 'carol@tabletree.test', now() - interval '1 day', 500,
        'cus_seed_test', 'pm_seed_test', 'pi_seed_delivered',
        'test-redeem-04', 'delivered')
on conflict (id) do nothing;

-- Floral line items (price_cents_snapshot + option_snapshot are stamped by the
-- guard trigger; requires floral_purchase_enabled=true and priced/active variants).
insert into booking_items (booking_id, variant_id, option_snapshot, quantity, price_cents_snapshot)
select '00000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-0000000000a2', '{}'::jsonb, 1, 0
where not exists (select 1 from booking_items
                  where booking_id='00000000-0000-0000-0000-000000000002'
                    and variant_id='22222222-0000-0000-0000-0000000000a2');

insert into booking_items (booking_id, variant_id, option_snapshot, quantity, price_cents_snapshot)
select '00000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-0000000000b1', '{"handle":"with"}'::jsonb, 1, 0
where not exists (select 1 from booking_items
                  where booking_id='00000000-0000-0000-0000-000000000003'
                    and variant_id='22222222-0000-0000-0000-0000000000b1');
