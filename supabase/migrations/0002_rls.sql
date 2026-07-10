-- Table-level privileges (RLS policies are ineffective without these).
grant select on products, product_variants, variant_options, app_config to anon, authenticated;
grant select, update on bookings to authenticated;
grant select, insert, delete on booking_items to authenticated;

alter table products         enable row level security;
alter table product_variants enable row level security;
alter table variant_options  enable row level security;
alter table app_config       enable row level security;
alter table bookings         enable row level security;
alter table booking_items    enable row level security;

-- Public catalog: readable by anon + authenticated, no writes.
create policy "catalog read products" on products
  for select to anon, authenticated using (true);
create policy "catalog read variants" on product_variants
  for select to anon, authenticated using (true);
create policy "catalog read options" on variant_options
  for select to anon, authenticated using (true);
create policy "config read" on app_config
  for select to anon, authenticated using (true);

-- Bookings: owner only.
create policy "own booking read" on bookings
  for select to authenticated using (user_id = auth.uid());
create policy "own booking update" on bookings
  for update to authenticated using (user_id = auth.uid());

-- Booking items: gated by parent booking ownership.
create policy "own items read" on booking_items
  for select to authenticated using (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
create policy "own items insert" on booking_items
  for insert to authenticated with check (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
create policy "own items delete" on booking_items
  for delete to authenticated using (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
