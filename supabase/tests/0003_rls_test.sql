begin;
select plan(3);

-- catalog readable as anon
set local role anon;
select ok((select count(*) from products) = 2, 'anon can read products');

-- a second user cannot see the demo user's booking
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
select is((select count(*) from bookings
           where id='00000000-0000-0000-0000-000000000001'),
          0::bigint, 'other user cannot read demo booking');

-- the demo user can see their own booking
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select is((select count(*) from bookings
           where id='00000000-0000-0000-0000-000000000001'),
          1::bigint, 'owner can read own booking');

select * from finish();
rollback;
