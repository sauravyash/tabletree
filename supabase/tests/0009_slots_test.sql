begin;
select plan(4);
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
-- Push any seeded booking's slot far away so it can't collide with candidates.
set local role postgres;
update bookings set slot_at = now() + interval '30 days' where slot_at is not null;
set local role authenticated; select _as_owner();
select start_draft_booking(null);
select ok((select count(*) from available_slots()) > 0, 'available_slots returns candidates');
create temporary table _pick as select slot_at from available_slots() order by slot_at limit 1;
select ok(hold_slot((select slot_at from _pick)), 'hold_slot succeeds on an open slot');
select ok((select hold_expires_at from bookings where user_id=auth.uid() and status='draft') > now(),
          'hold_expires_at set into the future');
set local role postgres;
insert into bookings (user_id, status, slot_at, hold_expires_at) values
  ('00000000-0000-0000-0000-0000000000aa', 'draft', (select slot_at from _pick), now() + interval '10 minutes'),
  ('00000000-0000-0000-0000-0000000000aa', 'draft', (select slot_at from _pick), now() + interval '10 minutes');
set local role authenticated; select _as_owner();
select ok(not hold_slot((select slot_at from _pick)), 'hold_slot rejects when slot capacity is exhausted');
select * from finish();
rollback;
