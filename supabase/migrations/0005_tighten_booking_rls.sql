-- Review finding (Critical): the client never updates bookings — status, pricing,
-- and stripe/payment fields are all server-owned (the edge function uses the
-- service-role key, which bypasses RLS). The broad UPDATE grant + owner policy let
-- a signed-in user rewrite coffee_price_cents / status / stripe_* on their own
-- booking and defeat the charge-integrity model. Remove it (least privilege).
drop policy if exists "own booking update" on bookings;
revoke update on bookings from authenticated;

-- Defense in depth: non-negative money and a sane quantity ceiling.
alter table booking_items
  add constraint booking_items_snapshot_nonneg check (price_cents_snapshot >= 0);
alter table booking_items
  add constraint booking_items_qty_bounds check (quantity between 1 and 99);
alter table bookings
  add constraint bookings_coffee_nonneg check (coffee_price_cents is null or coffee_price_cents >= 0);
