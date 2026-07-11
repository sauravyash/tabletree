begin;
select plan(4);
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_owner();
select isnt(start_draft_booking('SHOP42'), null, 'returns a draft booking id');
select is(start_draft_booking('SHOP42'), start_draft_booking('OTHER'), 'second call reuses the same draft');
select is((select store_code from bookings where user_id=auth.uid() and status='draft'),
          'SHOP42', 'store code stamped from first call');
select set_booking_beverage('Latte');
select is((select beverage from bookings where user_id=auth.uid() and status='draft'),
          'Latte', 'beverage set on draft');
select * from finish();
rollback;
