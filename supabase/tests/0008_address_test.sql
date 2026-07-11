begin;
select plan(5);
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_owner();
select start_draft_booking('SHOP42');
select ok(check_postcode('2017'), 'seeded postcode is in range');
select ok(not check_postcode('9999'), 'unknown postcode is out of range');
select ok(set_booking_address('1 King St', '', 'Sydney', '2017'), 'address accepted in range');
select is((select suburb from bookings where user_id=auth.uid() and status='draft'),
          'Sydney', 'suburb persisted');
select ok(not set_booking_address('X', '', 'Nowhere', '9999'), 'address rejected out of range');
select * from finish();
rollback;
