begin;
select plan(3);
select has_column('bookings', 'store_code', 'bookings has store_code');
select has_column('bookings', 'hold_expires_at', 'bookings has hold_expires_at');
select is(
  (select count(*)::int from app_config
     where key in ('delivery_postcodes','beverage_options','slot_schedule')),
  3, 'three funnel config rows seeded');
select * from finish();
rollback;
