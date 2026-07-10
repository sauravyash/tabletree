begin;
select plan(6);

select is(
  (select value from app_config where key='floral_purchase_enabled'),
  'false'::jsonb, 'purchase disabled by default');
select is((select count(*) from products), 2::bigint, 'exactly two products');
select is((select count(*) from product_variants), 5::bigint, 'five variants (3 TT + 2 Box)');
select is(
  (select count(*) from product_variants where price_cents is not null),
  0::bigint, 'all prices are placeholder (null)');
select is(
  (select count(*) from variant_options where option_key='handle'),
  4::bigint, 'each Box variant has with/without handle options');
select is(
  (select count(*) from bookings where id='00000000-0000-0000-0000-000000000001'),
  1::bigint, 'demo booking seeded');

select * from finish();
rollback;
