-- Additive staff-read: staff may SELECT every booking + item (for the staff
-- delivery queue). Owner-read policies from 0002 remain; no write path is opened
-- (booking state stays server-owned via the service-role edge function).
create policy "staff read all bookings" on bookings
  for select to authenticated using (has_role(auth.uid(), 'staff'));

create policy "staff read all items" on booking_items
  for select to authenticated using (has_role(auth.uid(), 'staff'));
