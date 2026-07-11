begin;
select plan(3);
create or replace function _as_wish_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_wish_owner();
select start_draft_booking('SHOP42');
select set_booking_wish('A sunny kitchen corner, please.');
select is((select wish from bookings where user_id = auth.uid() and status = 'draft'),
          'A sunny kitchen corner, please.', 'wish is stored on the caller-owned draft');
select set_booking_wish('   ');
select is((select wish from bookings where user_id = auth.uid() and status = 'draft'), null,
          'blank wish is cleared rather than stored');
select throws_ok($$select set_booking_wish(repeat('x', 501))$$, '23514', null,
                 'wish cannot exceed 500 characters');
select * from finish();
rollback;
