begin;
select plan(8);

select has_table('public','products','products table exists');
select has_table('public','product_variants','product_variants table exists');
select has_table('public','variant_options','variant_options table exists');
select has_table('public','bookings','bookings table exists');
select has_table('public','booking_items','booking_items table exists');
select has_table('public','app_config','app_config table exists');
select col_is_null('public','product_variants','price_cents','price_cents is nullable');
select col_not_null('public','booking_items','price_cents_snapshot','snapshot is not null');

select * from finish();
rollback;
