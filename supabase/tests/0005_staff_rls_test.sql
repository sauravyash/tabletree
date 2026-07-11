begin;
select plan(4);

-- staff user sees ALL bookings (owns none of them)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select ok((select count(*) from bookings) >= 4, 'staff sees all bookings');
select ok((select count(*) from bookings where id='00000000-0000-0000-0000-000000000002') = 1,
          'staff sees a booking they do not own');

-- a plain customer still sees only their own
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*) from bookings where id='00000000-0000-0000-0000-000000000001'),
          0::bigint, 'non-staff cannot see another user booking');
select is((select count(*) from bookings where id='00000000-0000-0000-0000-000000000002'),
          1::bigint, 'non-staff still sees own booking');

select * from finish();
rollback;
