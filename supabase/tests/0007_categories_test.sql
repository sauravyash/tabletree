begin;
select plan(5);
select has_column('products', 'category', 'products has category');
select has_column('bookings', 'purchase_category', 'bookings has purchase_category');
select has_column('booking_items', 'is_gift', 'booking_items has is_gift');
select col_is_null('product_variants', 'flower_count', 'flower_count is nullable');
select has_function('public', 'set_purchase_category', array['text'], 'set_purchase_category exists');
select * from finish();
rollback;
