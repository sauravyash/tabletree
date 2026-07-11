-- DEV-ONLY seed. Runs on non-production branches and local `supabase db reset`,
-- never on the production branch. Keeps demo credentials out of prod.

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

-- Demo booking (steps 1-6 assumed done; stripe fields filled separately)
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa',
        'Demo Customer', 'demo@tabletree.test', now() + interval '1 day', 500,
        'demo-redeem-01', 'pending')
on conflict (id) do nothing;
