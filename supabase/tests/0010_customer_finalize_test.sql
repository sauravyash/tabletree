begin;
select plan(4);
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_owner();
select start_draft_booking(null);
select set_booking_customer('Ada Lovelace');
select is((select customer_name from bookings where user_id=auth.uid() and status='draft'),
          'Ada Lovelace', 'customer name set');
select is((select email from bookings where user_id=auth.uid() and status='draft'),
          'demo@tabletree.test', 'email stamped from auth.email()');
select throws_ok('select finalize_draft_booking()', 'not_finalizable',
  'finalize rejected before a card is saved');
set local role postgres;
update bookings set stripe_payment_method_id = 'pm_x'
  where user_id='00000000-0000-0000-0000-0000000000aa' and status='draft';
set local role authenticated; select _as_owner();
select finalize_draft_booking();
select is((select count(*)::int from bookings
             where user_id='00000000-0000-0000-0000-0000000000aa' and status='pending'
               and stripe_payment_method_id='pm_x'), 1, 'draft finalized to pending');
select * from finish();
rollback;
