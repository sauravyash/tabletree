begin;
select plan(5);

create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
$$;

-- 1. flag off -> reject
set local role authenticated;
select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000a2', 999)$$,
  'floral_purchase_disabled', 'insert rejected while flag off');

-- enable the flag for the remaining cases
set local role postgres;
update app_config set value='true'::jsonb where key='floral_purchase_enabled';

-- 2. priced-null variant -> reject
set local role authenticated; select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000a2', 999)$$,
  'variant_unpriced', 'insert rejected when variant unpriced');

-- price the Medium Table Tree
set local role postgres;
update product_variants set price_cents=3800
  where id='22222222-0000-0000-0000-0000000000a2';

-- 3. success + snapshot stamped from variant (client 999 ignored)
set local role authenticated; select _as_owner();
insert into booking_items (booking_id, variant_id, price_cents_snapshot)
  values ('00000000-0000-0000-0000-000000000001',
          '22222222-0000-0000-0000-0000000000a2', 999);
select is((select price_cents_snapshot from booking_items limit 1),
          3800, 'snapshot stamped from variant, not client value');

-- 4. Table Tree option forced empty
select is((select option_snapshot from booking_items limit 1),
          '{}'::jsonb, 'table tree option snapshot forced empty');

-- 5. Box handle validated
set local role postgres;
update product_variants set price_cents=6500
  where id='22222222-0000-0000-0000-0000000000b1';
set local role authenticated; select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, option_snapshot, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000b1', '{"handle":"gold"}'::jsonb, 0)$$,
  'invalid_option', 'invalid handle value rejected');

select * from finish();
rollback;
