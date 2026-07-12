-- Beverages join flowers in the products table via a category flag; a booking records
-- which category the customer is buying (drives the reciprocal free gift on /bonus);
-- booking_items gains an is_gift flag so the free gift charges $0.

alter table products
  add column if not exists category text not null default 'flower';
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('beverage','flower'));

-- Beverages carry neither flower_count nor foliage_level.
alter table product_variants alter column flower_count drop not null;
alter table product_variants alter column foliage_level drop not null;

alter table bookings
  add column if not exists purchase_category text;
alter table bookings drop constraint if exists bookings_purchase_category_check;
alter table bookings add constraint bookings_purchase_category_check
  check (purchase_category is null or purchase_category in ('beverage','flower'));

alter table booking_items
  add column if not exists is_gift boolean not null default false;

create or replace function set_purchase_category(p_category text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_category not in ('beverage','flower') then raise exception 'bad_category'; end if;
  update bookings set purchase_category = p_category
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

grant execute on function set_purchase_category(text) to authenticated;
