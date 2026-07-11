-- Onboarding funnel: draft-booking columns, status vocabulary, config, and the
-- SECURITY DEFINER RPCs that let the browser progressively fill a draft booking
-- without ever writing money/status/stripe columns directly (charge integrity).

alter table bookings
  add column if not exists store_code      text,
  add column if not exists beverage        text,
  add column if not exists address_line1   text,
  add column if not exists address_line2   text,
  add column if not exists suburb          text,
  add column if not exists postcode        text,
  add column if not exists hold_expires_at timestamptz;

-- Status vocabulary (existing rows are only 'pending'/'delivered').
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('draft','pending','delivered','payment_failed'));

insert into app_config (key, value) values
  ('delivery_postcodes', '["2017","2018","2021","2031","2032"]'::jsonb),
  ('beverage_options',   '["Flat white","Latte","Cappuccino","Long black","Tea"]'::jsonb),
  ('slot_schedule',      '{"weekdays":[1,2,3,4,5,6,7],"startHour":9,"endHour":17,"slotMinutes":60,"capacity":3,"horizonDays":7}'::jsonb)
on conflict (key) do nothing;

-- ── Funnel RPCs ─────────────────────────────────────────────────────────────

create or replace function start_draft_booking(p_store_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from bookings where user_id = auth.uid() and status = 'draft' limit 1;
  if v_id is null then
    insert into bookings (user_id, status, store_code)
      values (auth.uid(), 'draft', p_store_code) returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function set_booking_beverage(p_beverage text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set beverage = p_beverage where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

create or replace function check_postcode(p_postcode text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from app_config, jsonb_array_elements_text(value) pc
    where key = 'delivery_postcodes' and trim(pc) = trim(p_postcode)
  );
$$;

create or replace function set_booking_address(
  p_line1 text, p_line2 text, p_suburb text, p_postcode text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not check_postcode(p_postcode) then return false; end if;
  update bookings
    set address_line1 = p_line1, address_line2 = p_line2, suburb = p_suburb, postcode = p_postcode
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
  return true;
end; $$;

create or replace function available_slots()
returns table(slot_at timestamptz, remaining int)
language sql security definer set search_path = public as $$
  with p as (select value s from app_config where key = 'slot_schedule'),
  cfg as (
    select (s->'weekdays') weekdays, (s->>'startHour')::int start_hour,
           (s->>'endHour')::int end_hour, (s->>'slotMinutes')::int slot_minutes,
           (s->>'capacity')::int capacity, (s->>'horizonDays')::int horizon_days
    from p),
  candidates as (
    select gs slot_at, c.capacity
    from cfg c,
      generate_series(
        date_trunc('day', now()) + make_interval(hours => c.start_hour),
        date_trunc('day', now()) + make_interval(days => c.horizon_days, hours => c.end_hour),
        make_interval(mins => c.slot_minutes)) gs
    where gs > now()
      and gs::time >= make_time(c.start_hour, 0, 0)
      and gs::time <  make_time(c.end_hour, 0, 0)
      and extract(isodow from gs)::int in (select jsonb_array_elements_text(c.weekdays)::int)),
  occ as (
    select b.slot_at, count(*) taken from bookings b
    where b.slot_at is not null
      and (b.status in ('pending','delivered')
           or (b.status = 'draft' and b.hold_expires_at > now()))
    group by b.slot_at)
  select c.slot_at, (c.capacity - coalesce(o.taken, 0))::int
  from candidates c left join occ o on o.slot_at = c.slot_at
  where (c.capacity - coalesce(o.taken, 0)) > 0
  order by c.slot_at;
$$;

create or replace function hold_slot(p_slot_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_capacity int; v_taken int;
begin
  select id into v_id from bookings where user_id = auth.uid() and status = 'draft' limit 1;
  if v_id is null then raise exception 'no_draft_booking'; end if;
  perform pg_advisory_xact_lock(hashtext(p_slot_at::text));
  select (value->>'capacity')::int into v_capacity from app_config where key = 'slot_schedule';
  select count(*) into v_taken from bookings b
    where b.slot_at = p_slot_at and b.id <> v_id
      and (b.status in ('pending','delivered')
           or (b.status = 'draft' and b.hold_expires_at > now()));
  if v_taken >= v_capacity then return false; end if;
  update bookings set slot_at = p_slot_at, hold_expires_at = now() + interval '10 minutes' where id = v_id;
  return true;
end; $$;

create or replace function set_booking_customer(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set customer_name = p_name, email = auth.email()
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

create or replace function finalize_draft_booking()
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set status = 'pending'
    where user_id = auth.uid() and status = 'draft'
      and stripe_payment_method_id is not null;
  if not found then raise exception 'not_finalizable'; end if;
end; $$;

grant execute on function start_draft_booking(text)         to authenticated;
grant execute on function set_booking_beverage(text)        to authenticated;
grant execute on function check_postcode(text)              to authenticated;
grant execute on function set_booking_address(text, text, text, text) to authenticated;
grant execute on function available_slots()                 to authenticated;
grant execute on function hold_slot(timestamptz)            to authenticated;
grant execute on function set_booking_customer(text)        to authenticated;
grant execute on function finalize_draft_booking()          to authenticated;
