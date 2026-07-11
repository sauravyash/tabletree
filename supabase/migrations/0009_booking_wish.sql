-- A customer's free-form wish belongs to their user-owned draft booking.
-- It remains server-written through a narrow RPC, like the other funnel fields.

alter table bookings add column if not exists wish text;
alter table bookings drop constraint if exists bookings_wish_length_check;
alter table bookings add constraint bookings_wish_length_check
  check (wish is null or char_length(wish) <= 500);

create or replace function set_booking_wish(p_wish text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings
    set wish = nullif(btrim(p_wish), '')
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

grant execute on function set_booking_wish(text) to authenticated;
