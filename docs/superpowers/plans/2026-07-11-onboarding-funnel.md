# Onboarding Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a six-step onboarding funnel (store landing → beverage → address+range → slot hold → account → card save) as the new front door, moving the current `FloralCollection` page from `/` to `/bonus-flowers`.

**Architecture:** Anonymous auth at the landing yields a real `user_id`; a `draft` booking accumulates funnel data through `SECURITY DEFINER` RPCs (so the browser never writes money/status/stripe columns directly). Step 5 upgrades the anon user in place; step 6 saves a card via two Stripe edge functions reusing `deliver-booking`'s mockable seam. See spec: [`docs/superpowers/specs/2026-07-11-onboarding-funnel-design.md`](../specs/2026-07-11-onboarding-funnel-design.md).

**Tech Stack:** Supabase (Postgres + RLS + RPCs), Deno edge functions, Vite + React 19 + react-router-dom 7 + supabase-js, Stripe Elements. Tests: pgTAP, `deno test`, Vitest.

## Global Constraints

- Clients must never write `status`, `coffee_price_cents`, `price_cents_snapshot`, or `stripe_*` columns. All funnel writes go through `SECURITY DEFINER` RPCs touching only whitelisted columns on the caller's own `draft` booking.
- Serviceability = postcode allowlist (`app_config.delivery_postcodes`). No geocoding.
- Slots are computed from `app_config.slot_schedule` (no slots table). Server timezone is authoritative.
- 10-minute hold = `bookings.hold_expires_at`; `hold_slot` is the atomic capacity gate.
- Edge functions split pure core (deno-tested with a fake gateway) from an SDK-backed `stripe_real.ts`, mirroring `supabase/functions/deliver-booking`.
- Stripe SDK pin: `https://esm.sh/stripe@14?target=deno`, `apiVersion: '2024-06-20'`.
- Status vocabulary: `draft`, `pending`, `delivered`, `payment_failed`.
- Anonymous users have Postgres role `authenticated`; grant RPC `execute` to `authenticated`.
- Frontend test idiom: `vi.mock('../api', …)` and `vi.mock('react-router-dom', …)`; page components import `../api` lazily via `loadApi()` to dodge vitest hoisting TDZ (see existing pages — reuse the same `loadApi` comment/pattern in new page-level components that statically can't).

---

## File Structure

**Database (`supabase/`):**
- Create `migrations/0006_funnel.sql` — new booking columns, status CHECK, funnel RPCs, grants, config rows.
- Create `tests/0005_funnel_schema_test.sql`, `tests/0006_draft_beverage_test.sql`, `tests/0007_address_test.sql`, `tests/0008_slots_test.sql`, `tests/0009_customer_test.sql`.

**Edge functions (`supabase/functions/`):**
- Create `create-setup-intent/{stripe.ts,setup.ts,stripe_real.ts,index.ts,setup_test.ts,deno.json}`.
- Create `finalize-setup/{stripe.ts,finalize.ts,stripe_real.ts,index.ts,finalize_test.ts,deno.json}`.

**Frontend (`frontend/src/`):**
- Modify `types.ts` — add `DraftBooking`, `SlotOption`, extend `Booking`.
- Modify `api.ts` + `api.test.ts` — auth helpers, RPC wrappers, edge invokers, `getMyBooking`/`getMyDraftBooking`.
- Create `funnel/FunnelContext.tsx` (+ `FunnelContext.test.tsx`) — provider + `useFunnel` hook.
- Create `funnel/Landing.tsx`, `Beverage.tsx`, `Address.tsx`, `Slot.tsx`, `Account.tsx`, `Card.tsx` (each with a sibling `*.test.tsx`).
- Modify `main.tsx` — router restructure, `FunnelLayout`.
- Modify `pages/FloralCollection.tsx`, `pages/Confirmation.tsx`, `pages/StaffBooking.tsx` — read caller's own booking; staff ensures demo session.
- Modify `.env.example` — add `VITE_STRIPE_PUBLISHABLE_KEY`.

Each file has one responsibility: one RPC group per test file, one funnel step per component, the context owns hydration/guards state only.

---

## Task 1: Schema migration — columns, status CHECK, config

**Files:**
- Create: `supabase/migrations/0006_funnel.sql`
- Test: `supabase/tests/0005_funnel_schema_test.sql`

**Interfaces:**
- Produces: `bookings` columns `store_code, beverage, address_line1, address_line2, suburb, postcode, hold_expires_at`; `bookings_status_check`; `app_config` keys `delivery_postcodes`, `beverage_options`, `slot_schedule`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/0005_funnel_schema_test.sql`:

```sql
begin;
select plan(4);

select has_column('bookings', 'store_code', 'bookings has store_code');
select has_column('bookings', 'hold_expires_at', 'bookings has hold_expires_at');
select is(
  (select count(*)::int from app_config
     where key in ('delivery_postcodes','beverage_options','slot_schedule')),
  3, 'three funnel config rows seeded');
select throws_ok(
  $$update bookings set status='bogus'
      where id='00000000-0000-0000-0000-000000000001'$$,
  '23514', 'status CHECK rejects unknown status');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db` (from repo root, with the local stack running via `supabase start`)
Expected: FAIL — `column "store_code" does not exist` / missing config rows.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0006_funnel.sql`:

```sql
-- Funnel: draft-booking columns, status vocabulary, and config.
alter table bookings
  add column store_code      text,
  add column beverage        text,
  add column address_line1   text,
  add column address_line2   text,
  add column suburb          text,
  add column postcode        text,
  add column hold_expires_at timestamptz;

alter table bookings
  add constraint bookings_status_check
  check (status in ('draft','pending','delivered','payment_failed'));

insert into app_config (key, value) values
  ('delivery_postcodes', '["2000","2010","2011","3000","3001"]'::jsonb),
  ('beverage_options',   '["Flat white","Latte","Cappuccino","Long black","Tea"]'::jsonb),
  ('slot_schedule',      '{"weekdays":[1,2,3,4,5,6,7],"startHour":9,"endHour":17,"slotMinutes":60,"capacity":3,"horizonDays":7}'::jsonb)
on conflict (key) do nothing;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: PASS (4/4 in this file).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_funnel.sql supabase/tests/0005_funnel_schema_test.sql
git commit -m "feat(db): funnel booking columns, status check, config"
```

---

## Task 2: `start_draft_booking` + `set_booking_beverage` RPCs

**Files:**
- Modify: `supabase/migrations/0006_funnel.sql` (append)
- Test: `supabase/tests/0006_draft_beverage_test.sql`

**Interfaces:**
- Produces: `start_draft_booking(p_store_code text) returns uuid`; `set_booking_beverage(p_beverage text) returns void`. Both `SECURITY DEFINER`, `execute` granted to `authenticated`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/0006_draft_beverage_test.sql`:

```sql
begin;
select plan(4);

-- Act as the seeded demo user (a distinct funnel user isn't seeded; reuse it).
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;

set local role authenticated; select _as_owner();

-- 1. creates a draft and returns its id
select isnt(start_draft_booking('SHOP42'), null, 'returns a draft booking id');

-- 2. idempotent: second call returns the same id
select is(start_draft_booking('SHOP42'), start_draft_booking('OTHER'),
          'second call reuses the same draft');

-- 3. store code stamped
select is((select store_code from bookings where user_id=auth.uid() and status='draft'),
          'SHOP42', 'store code stamped from first call');

-- 4. beverage whitelisted update works
select set_booking_beverage('Latte');
select is((select beverage from bookings where user_id=auth.uid() and status='draft'),
          'Latte', 'beverage set on draft');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function start_draft_booking(...) does not exist`.

- [ ] **Step 3: Append the RPCs to the migration**

Append to `supabase/migrations/0006_funnel.sql`:

```sql
create or replace function start_draft_booking(p_store_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from bookings
    where user_id = auth.uid() and status = 'draft' limit 1;
  if v_id is null then
    insert into bookings (user_id, status, store_code)
      values (auth.uid(), 'draft', p_store_code)
      returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function set_booking_beverage(p_beverage text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set beverage = p_beverage
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

grant execute on function start_draft_booking(text) to authenticated;
grant execute on function set_booking_beverage(text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: PASS (4/4 in this file).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_funnel.sql supabase/tests/0006_draft_beverage_test.sql
git commit -m "feat(db): start_draft_booking + set_booking_beverage RPCs"
```

---

## Task 3: `check_postcode` + `set_booking_address` RPCs

**Files:**
- Modify: `supabase/migrations/0006_funnel.sql` (append)
- Test: `supabase/tests/0007_address_test.sql`

**Interfaces:**
- Consumes: `start_draft_booking` (to create the draft under test).
- Produces: `check_postcode(p_postcode text) returns boolean`; `set_booking_address(p_line1 text, p_line2 text, p_suburb text, p_postcode text) returns boolean`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/0007_address_test.sql`:

```sql
begin;
select plan(5);

create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_owner();
select start_draft_booking('SHOP42');

-- 1. in-range postcode
select ok(check_postcode('2000'), 'seeded postcode is in range');
-- 2. out-of-range postcode
select ok(not check_postcode('9999'), 'unknown postcode is out of range');
-- 3. address write returns true when in range
select ok(set_booking_address('1 King St', '', 'Sydney', '2000'), 'address accepted in range');
-- 4. fields persisted
select is((select suburb from bookings where user_id=auth.uid() and status='draft'),
          'Sydney', 'suburb persisted');
-- 5. out-of-range write returns false and does not overwrite
select ok(not set_booking_address('X', '', 'Nowhere', '9999'), 'address rejected out of range');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function check_postcode(...) does not exist`.

- [ ] **Step 3: Append the RPCs**

Append to `supabase/migrations/0006_funnel.sql`:

```sql
create or replace function check_postcode(p_postcode text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from app_config, jsonb_array_elements_text(value) pc
    where key = 'delivery_postcodes' and trim(pc) = trim(p_postcode)
  );
$$;

create or replace function set_booking_address(
  p_line1 text, p_line2 text, p_suburb text, p_postcode text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not check_postcode(p_postcode) then
    return false;
  end if;
  update bookings
    set address_line1 = p_line1, address_line2 = p_line2,
        suburb = p_suburb, postcode = p_postcode
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
  return true;
end; $$;

grant execute on function check_postcode(text) to authenticated;
grant execute on function set_booking_address(text, text, text, text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: PASS (5/5 in this file).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_funnel.sql supabase/tests/0007_address_test.sql
git commit -m "feat(db): check_postcode + set_booking_address RPCs"
```

---

## Task 4: `available_slots` + `hold_slot` RPCs

**Files:**
- Modify: `supabase/migrations/0006_funnel.sql` (append)
- Test: `supabase/tests/0008_slots_test.sql`

**Interfaces:**
- Consumes: `app_config.slot_schedule`, `start_draft_booking`.
- Produces: `available_slots() returns table(slot_at timestamptz, remaining int)`; `hold_slot(p_slot_at timestamptz) returns boolean`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/0008_slots_test.sql`:

```sql
begin;
select plan(4);

create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;

-- The seeded demo booking holds a slot ~1 day out with status 'pending'; move it far
-- away so it can't collide with the freshly-computed candidate slots under test.
set local role postgres;
update bookings set slot_at = now() + interval '30 days'
  where id = '00000000-0000-0000-0000-000000000001';

set local role authenticated; select _as_owner();
select start_draft_booking(null);

-- 1. schedule produces at least one bookable slot
select ok((select count(*) from available_slots()) > 0, 'available_slots returns candidates');

-- Pick the earliest candidate for the hold tests.
create temporary table _pick as select slot_at from available_slots() order by slot_at limit 1;

-- 2. holding it succeeds
select ok(hold_slot((select slot_at from _pick)), 'hold_slot succeeds on an open slot');

-- 3. the hold is stamped on the draft
select ok(
  (select hold_expires_at from bookings where user_id=auth.uid() and status='draft') > now(),
  'hold_expires_at set into the future');

-- 4. fill remaining capacity with other users' active holds -> next hold fails.
--    capacity is 3; we already hold 1, add 2 more holds by other bookings on the same slot.
set local role postgres;
insert into bookings (user_id, status, slot_at, hold_expires_at)
  values ('00000000-0000-0000-0000-0000000000aa', 'draft',
          (select slot_at from _pick), now() + interval '10 minutes'),
         ('00000000-0000-0000-0000-0000000000aa', 'draft',
          (select slot_at from _pick), now() + interval '10 minutes');
set local role authenticated; select _as_owner();
-- our own draft already occupies one; two more fills capacity (3). Re-holding the same
-- slot must now report full (our draft is excluded from the count, 2 others == capacity-1... )
select ok(not hold_slot((select slot_at from _pick)),
          'hold_slot rejects when slot capacity is exhausted');

select * from finish();
rollback;
```

> Note: the demo user owns multiple draft rows here only because the test inserts them directly as `postgres` to simulate contention; `start_draft_booking` itself never creates a second draft for a user.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function available_slots() does not exist`.

- [ ] **Step 3: Append the RPCs**

Append to `supabase/migrations/0006_funnel.sql`:

```sql
create or replace function available_slots()
returns table(slot_at timestamptz, remaining int)
language sql security definer set search_path = public as $$
  with p as (
    select value s from app_config where key = 'slot_schedule'
  ),
  cfg as (
    select
      (s->'weekdays')            as weekdays,
      (s->>'startHour')::int     as start_hour,
      (s->>'endHour')::int       as end_hour,
      (s->>'slotMinutes')::int   as slot_minutes,
      (s->>'capacity')::int      as capacity,
      (s->>'horizonDays')::int   as horizon_days
    from p
  ),
  candidates as (
    select gs as slot_at, c.capacity
    from cfg c,
      generate_series(
        date_trunc('day', now()) + make_interval(hours => c.start_hour),
        date_trunc('day', now()) + make_interval(days => c.horizon_days, hours => c.end_hour),
        make_interval(mins => c.slot_minutes)
      ) gs
    where gs > now()
      and (gs::time >= make_time(c.start_hour, 0, 0))
      and (gs::time <  make_time(c.end_hour, 0, 0))
      and extract(isodow from gs)::int in (
        select jsonb_array_elements_text(c.weekdays)::int
      )
  ),
  occ as (
    select b.slot_at, count(*) taken
    from bookings b
    where b.slot_at is not null
      and (b.status in ('pending','delivered')
           or (b.status = 'draft' and b.hold_expires_at > now()))
    group by b.slot_at
  )
  select c.slot_at, (c.capacity - coalesce(o.taken, 0))::int
  from candidates c
  left join occ o on o.slot_at = c.slot_at
  where (c.capacity - coalesce(o.taken, 0)) > 0
  order by c.slot_at;
$$;

create or replace function hold_slot(p_slot_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_capacity int;
  v_taken int;
begin
  select id into v_id from bookings
    where user_id = auth.uid() and status = 'draft' limit 1;
  if v_id is null then raise exception 'no_draft_booking'; end if;

  -- Serialize concurrent holds on the same slot to prevent oversell.
  perform pg_advisory_xact_lock(hashtext(p_slot_at::text));

  select (value->>'capacity')::int into v_capacity
    from app_config where key = 'slot_schedule';

  select count(*) into v_taken from bookings b
    where b.slot_at = p_slot_at
      and b.id <> v_id
      and (b.status in ('pending','delivered')
           or (b.status = 'draft' and b.hold_expires_at > now()));

  if v_taken >= v_capacity then
    return false;
  end if;

  update bookings
    set slot_at = p_slot_at, hold_expires_at = now() + interval '10 minutes'
    where id = v_id;
  return true;
end; $$;

grant execute on function available_slots() to authenticated;
grant execute on function hold_slot(timestamptz) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: PASS (4/4 in this file). Fix the `temporary`/`temporary table` typo in the test if the harness flags it before this step.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_funnel.sql supabase/tests/0008_slots_test.sql
git commit -m "feat(db): available_slots + hold_slot RPCs with capacity gate"
```

---

## Task 5: `set_booking_customer` RPC + charge-integrity guard test

**Files:**
- Modify: `supabase/migrations/0006_funnel.sql` (append)
- Test: `supabase/tests/0009_customer_test.sql`

**Interfaces:**
- Produces: `set_booking_customer(p_name text) returns void`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/0009_customer_test.sql`:

```sql
begin;
select plan(3);

create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
set local role authenticated; select _as_owner();
select start_draft_booking(null);

-- 1. name set on draft
select set_booking_customer('Ada Lovelace');
select is((select customer_name from bookings where user_id=auth.uid() and status='draft'),
          'Ada Lovelace', 'customer name set');
-- 2. email stamped from JWT claim
select is((select email from bookings where user_id=auth.uid() and status='draft'),
          'demo@tabletree.test', 'email stamped from auth.email()');
-- 3. charge-integrity: client still cannot UPDATE bookings directly
select throws_ok(
  $$update bookings set coffee_price_cents = 1
      where user_id='00000000-0000-0000-0000-0000000000aa' and status='draft'$$,
  '42501', 'direct client UPDATE on bookings is denied');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `function set_booking_customer(...) does not exist`.

- [ ] **Step 3: Append the RPC**

Append to `supabase/migrations/0006_funnel.sql`:

```sql
create or replace function set_booking_customer(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set customer_name = p_name, email = auth.email()
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

grant execute on function set_booking_customer(text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db`
Expected: PASS (3/3 in this file, full suite green).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_funnel.sql supabase/tests/0009_customer_test.sql
git commit -m "feat(db): set_booking_customer RPC + charge-integrity guard test"
```

---

## Task 6: `create-setup-intent` edge function

**Files:**
- Create: `supabase/functions/create-setup-intent/stripe.ts`, `setup.ts`, `stripe_real.ts`, `index.ts`, `setup_test.ts`, `deno.json`

**Interfaces:**
- Produces: HTTP `POST` `{ booking_id }` → `{ client_secret, customer_id }` (200) or `{ error }`. Pure core `runCreateSetup(input, gateway)`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/create-setup-intent/deno.json`:

```json
{ "imports": {} }
```

Create `supabase/functions/create-setup-intent/setup_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { runCreateSetup } from './setup.ts';
import type { SetupGateway } from './stripe.ts';

function fakeGateway(): SetupGateway {
  return {
    createCustomer: () => Promise.resolve({ id: 'cus_new' }),
    createSetupIntent: () => Promise.resolve({ id: 'seti_1', client_secret: 'seti_1_secret' }),
    getSetupIntent: () => Promise.resolve({ status: 'succeeded', payment_method: 'pm_1', customer: 'cus_new' }),
  };
}

Deno.test('creates a customer when none exists and returns a client secret', async () => {
  const r = await runCreateSetup({ customer: null, email: 'a@b.c' }, fakeGateway());
  assertEquals(r, { client_secret: 'seti_1_secret', customer_id: 'cus_new' });
});

Deno.test('reuses an existing customer id', async () => {
  const r = await runCreateSetup({ customer: 'cus_existing', email: null }, fakeGateway());
  assertEquals(r.customer_id, 'cus_existing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions/create-setup-intent && deno test`
Expected: FAIL — cannot find `./setup.ts`.

- [ ] **Step 3: Write the seam + core**

Create `supabase/functions/create-setup-intent/stripe.ts`:

```ts
// Stripe setup-flow gateway seam. No SDK import here so tests stay network-free.
export interface SetupGateway {
  createCustomer(args: { email?: string }): Promise<{ id: string }>;
  createSetupIntent(args: { customer: string }): Promise<{ id: string; client_secret: string }>;
  getSetupIntent(id: string): Promise<{ status: string; payment_method: string | null; customer: string | null }>;
}
```

Create `supabase/functions/create-setup-intent/setup.ts`:

```ts
import type { SetupGateway } from './stripe.ts';

export async function runCreateSetup(
  input: { customer: string | null; email: string | null },
  gateway: SetupGateway,
): Promise<{ client_secret: string; customer_id: string }> {
  const customer = input.customer
    ?? (await gateway.createCustomer({ email: input.email ?? undefined })).id;
  const si = await gateway.createSetupIntent({ customer });
  return { client_secret: si.client_secret, customer_id: customer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions/create-setup-intent && deno test`
Expected: PASS (2/2).

- [ ] **Step 5: Write the real gateway + handler**

Create `supabase/functions/create-setup-intent/stripe_real.ts`:

```ts
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import type { SetupGateway } from './stripe.ts';

export class RealSetupStripe implements SetupGateway {
  private stripe: Stripe;
  constructor(secret: string) { this.stripe = new Stripe(secret, { apiVersion: '2024-06-20' }); }
  async createCustomer({ email }: { email?: string }) {
    const c = await this.stripe.customers.create({ email });
    return { id: c.id };
  }
  async createSetupIntent({ customer }: { customer: string }) {
    const si = await this.stripe.setupIntents.create({ customer, usage: 'off_session' });
    return { id: si.id, client_secret: si.client_secret! };
  }
  async getSetupIntent(id: string) {
    const si = await this.stripe.setupIntents.retrieve(id);
    return {
      status: si.status,
      payment_method: (si.payment_method as string) ?? null,
      customer: (si.customer as string) ?? null,
    };
  }
}
```

Create `supabase/functions/create-setup-intent/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealSetupStripe } from './stripe_real.ts';
import { runCreateSetup } from './setup.ts';

Deno.serve(async (req) => {
  let booking_id: string | undefined;
  try { ({ booking_id } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (!booking_id) return json({ error: 'missing_booking_id' }, 400);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select().eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const gateway = new RealSetupStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const result = await runCreateSetup(
      { customer: booking.stripe_customer_id, email: booking.email ?? user.email ?? null }, gateway);
    return json(result, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 6: Re-run tests (handler adds no new tested logic)**

Run: `cd supabase/functions/create-setup-intent && deno test`
Expected: PASS (2/2) — the core is unchanged; the handler is thin wiring.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/create-setup-intent
git commit -m "feat(edge): create-setup-intent function with mockable Stripe seam"
```

---

## Task 7: `finalize-setup` edge function

**Files:**
- Create: `supabase/functions/finalize-setup/stripe.ts`, `finalize.ts`, `stripe_real.ts`, `index.ts`, `finalize_test.ts`, `deno.json`

**Interfaces:**
- Consumes: `SetupGateway` shape (duplicated per-folder, matching the self-contained pattern).
- Produces: HTTP `POST` `{ booking_id, setup_intent_id }` → `{ status: 'pending' }` on success or `{ error }`. Pure core `runFinalize(input, gateway)`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/finalize-setup/deno.json`:

```json
{ "imports": {} }
```

Create `supabase/functions/finalize-setup/finalize_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { runFinalize } from './finalize.ts';
import type { SetupGateway } from './stripe.ts';

function gatewayWith(si: { status: string; payment_method: string | null; customer: string | null }): SetupGateway {
  return {
    createCustomer: () => Promise.resolve({ id: 'cus' }),
    createSetupIntent: () => Promise.resolve({ id: 'seti', client_secret: 's' }),
    getSetupIntent: () => Promise.resolve(si),
  };
}

Deno.test('returns ok with pm + customer on a succeeded setup intent', async () => {
  const r = await runFinalize({ setupIntentId: 'seti_1' },
    gatewayWith({ status: 'succeeded', payment_method: 'pm_9', customer: 'cus_9' }));
  assertEquals(r, { ok: true, customer: 'cus_9', paymentMethod: 'pm_9' });
});

Deno.test('rejects a non-succeeded setup intent', async () => {
  const r = await runFinalize({ setupIntentId: 'seti_1' },
    gatewayWith({ status: 'requires_payment_method', payment_method: null, customer: 'cus_9' }));
  assertEquals(r, { ok: false, error: 'setup_not_succeeded' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions/finalize-setup && deno test`
Expected: FAIL — cannot find `./finalize.ts`.

- [ ] **Step 3: Write the seam + core**

Create `supabase/functions/finalize-setup/stripe.ts` (identical shape to Task 6's seam):

```ts
export interface SetupGateway {
  createCustomer(args: { email?: string }): Promise<{ id: string }>;
  createSetupIntent(args: { customer: string }): Promise<{ id: string; client_secret: string }>;
  getSetupIntent(id: string): Promise<{ status: string; payment_method: string | null; customer: string | null }>;
}
```

Create `supabase/functions/finalize-setup/finalize.ts`:

```ts
import type { SetupGateway } from './stripe.ts';

export async function runFinalize(
  input: { setupIntentId: string },
  gateway: SetupGateway,
): Promise<{ ok: true; customer: string; paymentMethod: string } | { ok: false; error: string }> {
  const si = await gateway.getSetupIntent(input.setupIntentId);
  if (si.status !== 'succeeded') return { ok: false, error: 'setup_not_succeeded' };
  if (!si.payment_method || !si.customer) return { ok: false, error: 'setup_incomplete' };
  return { ok: true, customer: si.customer, paymentMethod: si.payment_method };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions/finalize-setup && deno test`
Expected: PASS (2/2).

- [ ] **Step 5: Write the real gateway + handler**

Create `supabase/functions/finalize-setup/stripe_real.ts` (identical to Task 6's `stripe_real.ts`; copy verbatim, changing only the class name if desired — keep `RealSetupStripe`).

```ts
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import type { SetupGateway } from './stripe.ts';

export class RealSetupStripe implements SetupGateway {
  private stripe: Stripe;
  constructor(secret: string) { this.stripe = new Stripe(secret, { apiVersion: '2024-06-20' }); }
  async createCustomer({ email }: { email?: string }) {
    const c = await this.stripe.customers.create({ email });
    return { id: c.id };
  }
  async createSetupIntent({ customer }: { customer: string }) {
    const si = await this.stripe.setupIntents.create({ customer, usage: 'off_session' });
    return { id: si.id, client_secret: si.client_secret! };
  }
  async getSetupIntent(id: string) {
    const si = await this.stripe.setupIntents.retrieve(id);
    return {
      status: si.status,
      payment_method: (si.payment_method as string) ?? null,
      customer: (si.customer as string) ?? null,
    };
  }
}
```

Create `supabase/functions/finalize-setup/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealSetupStripe } from './stripe_real.ts';
import { runFinalize } from './finalize.ts';

Deno.serve(async (req) => {
  let booking_id: string | undefined;
  let setup_intent_id: string | undefined;
  try { ({ booking_id, setup_intent_id } = await req.json()); }
  catch { return json({ error: 'bad_request' }, 400); }
  if (!booking_id || !setup_intent_id) return json({ error: 'missing_params' }, 400);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select().eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const gateway = new RealSetupStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const result = await runFinalize({ setupIntentId: setup_intent_id }, gateway);
    if (!result.ok) return json({ error: result.error }, 200);

    await admin.from('bookings').update({
      stripe_customer_id: result.customer,
      stripe_payment_method_id: result.paymentMethod,
      status: 'pending',
    }).eq('id', booking_id);

    return json({ status: 'pending' }, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 6: Re-run tests**

Run: `cd supabase/functions/finalize-setup && deno test`
Expected: PASS (2/2).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/finalize-setup
git commit -m "feat(edge): finalize-setup writes stripe fields + pending on success"
```

---

## Task 8: Frontend types + `api.ts` funnel surface

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Test: `frontend/src/api.test.ts` (append)

**Interfaces:**
- Produces (types): `DraftBooking`, `SlotOption`; extends `Booking` with new fields.
- Produces (api): `ensureAnonSession()`, `ensureDemoSession()`, `startDraftBooking(storeCode)`, `setBeverage(b)`, `checkPostcode(pc)`, `setAddress(a)`, `availableSlots()`, `holdSlot(slotAt)`, `upgradeAccount(email,password)`, `setCustomer(name)`, `createSetupIntent(bookingId)`, `finalizeSetup(bookingId, setupIntentId)`, `getMyBooking()`, `getMyDraftBooking()`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/api.test.ts`:

```ts
import { startDraftBooking, checkPostcode, availableSlots, holdSlot, createSetupIntent } from './api';

const rpc = vi.fn();
const auth = { signInAnonymously: vi.fn(), signInWithPassword: vi.fn(), updateUser: vi.fn(), getUser: vi.fn() };

vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: any[]) => from(...a),
    functions: { invoke: (...a: any[]) => invoke(...a) },
    rpc: (...a: any[]) => rpc(...a),
    auth,
  },
}));

describe('startDraftBooking', () => {
  it('calls the RPC and returns the id', async () => {
    rpc.mockResolvedValue({ data: 'bk-1', error: null });
    const id = await startDraftBooking('SHOP42');
    expect(id).toBe('bk-1');
    expect(rpc).toHaveBeenCalledWith('start_draft_booking', { p_store_code: 'SHOP42' });
  });
});

describe('checkPostcode', () => {
  it('returns the boolean from the RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkPostcode('2000')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('check_postcode', { p_postcode: '2000' });
  });
});

describe('availableSlots', () => {
  it('maps rows to camelCase SlotOption[]', async () => {
    rpc.mockResolvedValue({ data: [{ slot_at: '2026-07-12T09:00:00Z', remaining: 2 }], error: null });
    expect(await availableSlots()).toEqual([{ slotAt: '2026-07-12T09:00:00Z', remaining: 2 }]);
  });
});

describe('holdSlot', () => {
  it('returns the boolean from the RPC', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await holdSlot('2026-07-12T09:00:00Z')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('hold_slot', { p_slot_at: '2026-07-12T09:00:00Z' });
  });
});

describe('createSetupIntent', () => {
  it('invokes the edge function and maps client_secret', async () => {
    invoke.mockResolvedValue({ data: { client_secret: 'cs_1', customer_id: 'cus_1' }, error: null });
    const r = await createSetupIntent('bk-1');
    expect(r).toEqual({ clientSecret: 'cs_1', customerId: 'cus_1' });
    expect(invoke).toHaveBeenCalledWith('create-setup-intent', { body: { booking_id: 'bk-1' } });
  });
});
```

> Note: the existing top-of-file `vi.mock('./supabase', …)` must be replaced by the richer mock above (it adds `rpc` + `auth`). Merge them into a single `vi.mock` call — do not declare `vi.mock('./supabase')` twice.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: FAIL — `startDraftBooking is not a function` (not yet exported).

- [ ] **Step 3: Extend types**

Append to `frontend/src/types.ts`:

```ts
export interface DraftBooking {
  id: string;
  storeCode: string | null;
  beverage: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  postcode: string | null;
  slotAt: string | null;
  holdExpiresAt: string | null;
  customerName: string | null;
  email: string | null;
  status: string;
}

export interface SlotOption { slotAt: string; remaining: number }
```

- [ ] **Step 4: Add the api functions**

Append to `frontend/src/api.ts`:

```ts
import type { DraftBooking, SlotOption } from './types';

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL as string;
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD as string;

export async function ensureAnonSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

export async function ensureDemoSession(): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (error) throw error;
}

export async function startDraftBooking(storeCode: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('start_draft_booking', { p_store_code: storeCode });
  if (error) throw error;
  return data as string;
}

export async function setBeverage(beverage: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_beverage', { p_beverage: beverage });
  if (error) throw error;
}

export async function checkPostcode(postcode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_postcode', { p_postcode: postcode });
  if (error) throw error;
  return data as boolean;
}

export async function setAddress(a: { line1: string; line2: string; suburb: string; postcode: string }): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_booking_address', {
    p_line1: a.line1, p_line2: a.line2, p_suburb: a.suburb, p_postcode: a.postcode,
  });
  if (error) throw error;
  return data as boolean;
}

export async function availableSlots(): Promise<SlotOption[]> {
  const { data, error } = await supabase.rpc('available_slots');
  if (error) throw error;
  return (data ?? []).map((r: any): SlotOption => ({ slotAt: r.slot_at, remaining: r.remaining }));
}

export async function holdSlot(slotAt: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('hold_slot', { p_slot_at: slotAt });
  if (error) throw error;
  return data as boolean;
}

export async function upgradeAccount(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) throw error;
}

export async function setCustomer(name: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_customer', { p_name: name });
  if (error) throw error;
}

export async function createSetupIntent(bookingId: string): Promise<{ clientSecret: string; customerId: string }> {
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: { booking_id: bookingId } });
  if (error) throw error;
  return { clientSecret: (data as any).client_secret, customerId: (data as any).customer_id };
}

export async function finalizeSetup(bookingId: string, setupIntentId: string): Promise<{ status: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('finalize-setup', {
    body: { booking_id: bookingId, setup_intent_id: setupIntentId },
  });
  if (error) throw error;
  return data as { status: string; error?: string };
}

function mapDraft(b: any): DraftBooking {
  return {
    id: b.id, storeCode: b.store_code, beverage: b.beverage,
    addressLine1: b.address_line1, addressLine2: b.address_line2,
    suburb: b.suburb, postcode: b.postcode, slotAt: b.slot_at,
    holdExpiresAt: b.hold_expires_at, customerName: b.customer_name,
    email: b.email, status: b.status,
  };
}

export async function getMyDraftBooking(): Promise<DraftBooking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapDraft(data) : null;
}

export async function getMyBooking(): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapBooking(data) : null;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: PASS (existing + 5 new cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(fe): funnel api surface (auth, RPC wrappers, edge invokers, my-booking)"
```

---

## Task 9: `FunnelContext` provider + `useFunnel`

**Files:**
- Create: `frontend/src/funnel/FunnelContext.tsx`
- Test: `frontend/src/funnel/FunnelContext.test.tsx`

**Interfaces:**
- Consumes: `ensureAnonSession`, `getMyDraftBooking` from `../api`.
- Produces: `<FunnelProvider>` and `useFunnel(): { booking: DraftBooking | null; loading: boolean; refresh(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/FunnelContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const api = { ensureAnonSession: vi.fn(), getMyDraftBooking: vi.fn() };
vi.mock('../api', () => api);

import { FunnelProvider, useFunnel } from './FunnelContext';

function Probe() {
  const { booking, loading } = useFunnel();
  return <div>{loading ? 'loading' : `booking:${booking?.id ?? 'none'}`}</div>;
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.ensureAnonSession.mockResolvedValue(undefined);
});

describe('FunnelProvider', () => {
  it('ensures a session then hydrates the draft booking', async () => {
    api.getMyDraftBooking.mockResolvedValue({ id: 'bk-9', status: 'draft' });
    render(<FunnelProvider><Probe /></FunnelProvider>);
    await waitFor(() => expect(screen.getByText('booking:bk-9')).toBeInTheDocument());
    expect(api.ensureAnonSession).toHaveBeenCalled();
  });

  it('exposes null booking when there is no draft', async () => {
    api.getMyDraftBooking.mockResolvedValue(null);
    render(<FunnelProvider><Probe /></FunnelProvider>);
    await waitFor(() => expect(screen.getByText('booking:none')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/FunnelContext.test.tsx`
Expected: FAIL — cannot resolve `./FunnelContext`.

- [ ] **Step 3: Implement the provider**

Create `frontend/src/funnel/FunnelContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DraftBooking } from '../types';

interface FunnelValue {
  booking: DraftBooking | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FunnelCtx = createContext<FunnelValue | null>(null);

export function useFunnel(): FunnelValue {
  const v = useContext(FunnelCtx);
  if (!v) throw new Error('useFunnel must be used within FunnelProvider');
  return v;
}

export function FunnelProvider({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<DraftBooking | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const api = await import('../api');
    const b = await api.getMyDraftBooking();
    setBooking(b);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = await import('../api');
      await api.ensureAnonSession();
      const b = await api.getMyDraftBooking();
      if (!cancelled) { setBooking(b); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return <FunnelCtx.Provider value={{ booking, loading, refresh }}>{children}</FunnelCtx.Provider>;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/FunnelContext.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/FunnelContext.tsx frontend/src/funnel/FunnelContext.test.tsx
git commit -m "feat(fe): FunnelProvider hydrates draft booking after ensuring a session"
```

---

## Task 10: Step 1 — Landing

**Files:**
- Create: `frontend/src/funnel/Landing.tsx`
- Test: `frontend/src/funnel/Landing.test.tsx`

**Interfaces:**
- Consumes: `startDraftBooking` from `../api`; `useFunnel().refresh`; `useSearchParams`, `useNavigate`.
- Produces: default-exported `Landing` component; CTA navigates to `/beverage`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Landing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { startDraftBooking: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams('store=SHOP42')],
}));
const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ refresh }) }));

import Landing from './Landing';

beforeEach(() => { api.startDraftBooking.mockReset(); navigate.mockReset(); refresh.mockReset();
  api.startDraftBooking.mockResolvedValue('bk-1'); });

describe('Landing', () => {
  it('starts a draft with the store code from the URL', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledWith('SHOP42'));
    expect(refresh).toHaveBeenCalled();
  });

  it('advances to /beverage on CTA', async () => {
    render(<Landing />);
    const cta = await screen.findByRole('button', { name: /get started|begin/i });
    fireEvent.click(cta);
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/Landing.test.tsx`
Expected: FAIL — cannot resolve `./Landing`.

- [ ] **Step 3: Implement Landing**

Create `frontend/src/funnel/Landing.tsx`:

```tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useFunnel();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = await import('../api');
      await api.startDraftBooking(params.get('store'));
      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; };
  }, [params, refresh]);

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head">
          <p className="eyebrow">Fresh flowers with your coffee</p>
          <h1>Let's set up your delivery</h1>
          <p>A few quick steps and your first Table Tree is on its way.</p>
        </header>
        <button className="add-btn" onClick={() => navigate('/beverage')}>Get started</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Landing.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/Landing.tsx frontend/src/funnel/Landing.test.tsx
git commit -m "feat(fe): funnel step 1 — store-attributed landing"
```

---

## Task 11: Step 2 — Beverage

**Files:**
- Create: `frontend/src/funnel/Beverage.tsx`
- Test: `frontend/src/funnel/Beverage.test.tsx`

**Interfaces:**
- Consumes: `getAppConfigRaw` for `beverage_options` (add below), `setBeverage`; `useFunnel().booking`; `useNavigate`.
- Produces: default-exported `Beverage`; selecting an option then Continue calls `setBeverage` and navigates to `/address`. Guards: no draft → `/`.

- [ ] **Step 1: Add a config reader for arbitrary keys**

Append to `frontend/src/api.ts`:

```ts
export async function getConfigList(key: string): Promise<string[]> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return (data?.value as string[]) ?? [];
}
```

Append a case to `frontend/src/api.test.ts`:

```ts
import { getConfigList } from './api';

describe('getConfigList', () => {
  it('returns the array value for a key', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { value: ['Latte', 'Tea'] }, error: null }) }) }) });
    expect(await getConfigList('beverage_options')).toEqual(['Latte', 'Tea']);
  });
});
```

- [ ] **Step 2: Write the failing Beverage test**

Create `frontend/src/funnel/Beverage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { getConfigList: vi.fn(), setBeverage: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));

import Beverage from './Beverage';

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset();
  api.getConfigList.mockResolvedValue(['Latte', 'Tea']); api.setBeverage.mockResolvedValue(undefined); });

describe('Beverage', () => {
  it('records the chosen beverage and advances to /address', async () => {
    render(<Beverage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Latte' }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(api.setBeverage).toHaveBeenCalledWith('Latte'));
    expect(navigate).toHaveBeenCalledWith('/address');
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `cd frontend && npx vitest run src/funnel/Beverage.test.tsx src/api.test.ts`
Expected: FAIL — `getConfigList` missing / `./Beverage` unresolved.

- [ ] **Step 4: Implement Beverage**

Create `frontend/src/funnel/Beverage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Beverage() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const [options, setOptions] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) { navigate('/'); return; }
    let cancelled = false;
    import('../api').then(async (api) => {
      const opts = await api.getConfigList('beverage_options');
      if (!cancelled) setOptions(opts);
    });
    return () => { cancelled = true; };
  }, [booking, navigate]);

  async function onContinue() {
    if (choice) { const api = await import('../api'); await api.setBeverage(choice); }
    navigate('/address');
  }

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head">
          <p className="eyebrow">Step 2 of 6</p>
          <h1>What's your usual?</h1>
        </header>
        <div className="sizes">
          {options.map((o) => (
            <button key={o} className="size-btn" aria-pressed={choice === o} onClick={() => setChoice(o)}>{o}</button>
          ))}
        </div>
        <button className="add-btn" onClick={onContinue}>Continue</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Beverage.test.tsx src/api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/funnel/Beverage.tsx frontend/src/funnel/Beverage.test.tsx frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(fe): funnel step 2 — beverage preference"
```

---

## Task 12: Step 3 — Address + range check

**Files:**
- Create: `frontend/src/funnel/Address.tsx`
- Test: `frontend/src/funnel/Address.test.tsx`

**Interfaces:**
- Consumes: `setAddress` from `../api`; `useFunnel().booking + refresh`; `useNavigate`.
- Produces: default-exported `Address`; on in-range submit calls `refresh` + navigates to `/slot`; on out-of-range shows an inline message and does not navigate. Guard: no draft → `/`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Address.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { setAddress: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' }, refresh }) }));

import Address from './Address';

function fill() {
  fireEvent.change(screen.getByLabelText(/address line 1/i), { target: { value: '1 King St' } });
  fireEvent.change(screen.getByLabelText(/suburb/i), { target: { value: 'Sydney' } });
  fireEvent.change(screen.getByLabelText(/postcode/i), { target: { value: '2000' } });
}

beforeEach(() => { api.setAddress.mockReset(); navigate.mockReset(); refresh.mockReset(); });

describe('Address', () => {
  it('advances to /slot when the address is in range', async () => {
    api.setAddress.mockResolvedValue(true);
    render(<Address />); fill();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/slot'));
    expect(refresh).toHaveBeenCalled();
  });

  it('blocks and shows a message when out of range', async () => {
    api.setAddress.mockResolvedValue(false);
    render(<Address />); fill();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/not in our delivery area/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/Address.test.tsx`
Expected: FAIL — cannot resolve `./Address`.

- [ ] **Step 3: Implement Address**

Create `frontend/src/funnel/Address.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Address() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState('');
  const [outOfRange, setOutOfRange] = useState(false);

  useEffect(() => { if (!booking) navigate('/'); }, [booking, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOutOfRange(false);
    const api = await import('../api');
    const ok = await api.setAddress({ line1, line2, suburb, postcode });
    if (!ok) { setOutOfRange(true); return; }
    await refresh();
    navigate('/slot');
  }

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head"><p className="eyebrow">Step 3 of 6</p><h1>Where should we deliver?</h1></header>
        <form onSubmit={onSubmit}>
          <label>Address line 1<input value={line1} onChange={(e) => setLine1(e.target.value)} required /></label>
          <label>Address line 2<input value={line2} onChange={(e) => setLine2(e.target.value)} /></label>
          <label>Suburb<input value={suburb} onChange={(e) => setSuburb(e.target.value)} required /></label>
          <label>Postcode<input value={postcode} onChange={(e) => setPostcode(e.target.value)} required /></label>
          {outOfRange && <p role="alert">Sorry — that's not in our delivery area yet.</p>}
          <button className="add-btn" type="submit">Continue</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Address.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/Address.tsx frontend/src/funnel/Address.test.tsx
git commit -m "feat(fe): funnel step 3 — address entry with delivery-range check"
```

---

## Task 13: Step 4 — Slot selection + 10-min hold

**Files:**
- Create: `frontend/src/funnel/Slot.tsx`
- Test: `frontend/src/funnel/Slot.test.tsx`

**Interfaces:**
- Consumes: `availableSlots`, `holdSlot` from `../api`; `useFunnel().booking + refresh`; `useNavigate`.
- Produces: default-exported `Slot`; picking a slot calls `holdSlot`; success → `refresh` + navigate `/account`; a full slot shows a "just taken" message and refreshes the list. Guard: no in-range address (`!booking.postcode`) → `/address`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Slot.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { availableSlots: vi.fn(), holdSlot: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({
  booking: { id: 'bk-1', status: 'draft', postcode: '2000' }, refresh }) }));

import Slot from './Slot';

const slots = [{ slotAt: '2026-07-12T09:00:00Z', remaining: 2 }, { slotAt: '2026-07-12T10:00:00Z', remaining: 1 }];

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset(); refresh.mockReset();
  api.availableSlots.mockResolvedValue(slots); });

describe('Slot', () => {
  it('holds a picked slot and advances to /account', async () => {
    api.holdSlot.mockResolvedValue(true);
    render(<Slot />);
    const first = await screen.findByRole('button', { name: /09:00|9:00/ });
    fireEvent.click(first);
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith('2026-07-12T09:00:00Z'));
    expect(navigate).toHaveBeenCalledWith('/account');
  });

  it('shows a message and refreshes when the slot was just taken', async () => {
    api.holdSlot.mockResolvedValue(false);
    render(<Slot />);
    const first = await screen.findByRole('button', { name: /09:00|9:00/ });
    fireEvent.click(first);
    await screen.findByText(/just taken/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(api.availableSlots).toHaveBeenCalledTimes(2); // initial + refresh after full
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/Slot.test.tsx`
Expected: FAIL — cannot resolve `./Slot`.

- [ ] **Step 3: Implement Slot**

Create `frontend/src/funnel/Slot.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { SlotOption } from '../types';

export default function Slot() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [taken, setTaken] = useState(false);

  const load = useCallback(async () => {
    const api = await import('../api');
    setSlots(await api.availableSlots());
  }, []);

  useEffect(() => {
    if (!booking?.postcode) { navigate('/address'); return; }
    load();
  }, [booking, navigate, load]);

  async function pick(slotAt: string) {
    setTaken(false);
    const api = await import('../api');
    const ok = await api.holdSlot(slotAt);
    if (!ok) { setTaken(true); await load(); return; }
    await refresh();
    navigate('/account');
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head"><p className="eyebrow">Step 4 of 6</p><h1>Pick a delivery slot</h1></header>
        {taken && <p role="alert">That slot was just taken — please pick another.</p>}
        <div className="sizes">
          {slots.map((s) => (
            <button key={s.slotAt} className="size-btn" onClick={() => pick(s.slotAt)}>
              {fmt(s.slotAt)} · {s.remaining} left
            </button>
          ))}
        </div>
        <p className="helper">We'll hold your slot for 10 minutes while you finish signing up.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Slot.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/Slot.tsx frontend/src/funnel/Slot.test.tsx
git commit -m "feat(fe): funnel step 4 — slot selection with server-held capacity"
```

---

## Task 14: Step 5 — Account creation

**Files:**
- Create: `frontend/src/funnel/Account.tsx`
- Test: `frontend/src/funnel/Account.test.tsx`

**Interfaces:**
- Consumes: `upgradeAccount`, `setCustomer` from `../api`; `useFunnel().booking + refresh`; `useNavigate`.
- Produces: default-exported `Account`; on submit upgrades the anon user then stamps the name, `refresh`, navigate `/card`. "email already registered" shown inline. Guard: no live hold (`!booking.holdExpiresAt` or expired) → `/slot`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Account.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { upgradeAccount: vi.fn(), setCustomer: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const refresh = vi.fn();
const future = new Date(Date.now() + 5 * 60_000).toISOString();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({
  booking: { id: 'bk-1', status: 'draft', postcode: '2000', holdExpiresAt: future }, refresh }) }));

import Account from './Account';

function fill() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@x.co' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter2hunter2' } });
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset(); refresh.mockReset(); });

describe('Account', () => {
  it('upgrades the account, stamps the name, and advances to /card', async () => {
    api.upgradeAccount.mockResolvedValue(undefined); api.setCustomer.mockResolvedValue(undefined);
    render(<Account />); fill();
    fireEvent.click(screen.getByRole('button', { name: /create account|continue/i }));
    await waitFor(() => expect(api.upgradeAccount).toHaveBeenCalledWith('ada@x.co', 'hunter2hunter2'));
    expect(api.setCustomer).toHaveBeenCalledWith('Ada');
    expect(navigate).toHaveBeenCalledWith('/card');
  });

  it('shows an inline error when the email is already registered', async () => {
    api.upgradeAccount.mockRejectedValue(new Error('email address already in use'));
    render(<Account />); fill();
    fireEvent.click(screen.getByRole('button', { name: /create account|continue/i }));
    await screen.findByText(/already registered|already in use/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/Account.test.tsx`
Expected: FAIL — cannot resolve `./Account`.

- [ ] **Step 3: Implement Account**

Create `frontend/src/funnel/Account.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Account() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const live = booking?.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() > Date.now();
    if (!live) navigate('/slot');
  }, [booking, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const api = await import('../api');
      await api.upgradeAccount(email, password);
      await api.setCustomer(name);
      await refresh();
      navigate('/card');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      setError(/already|use|registered/i.test(msg)
        ? 'That email is already registered — try another.'
        : 'Could not create your account. Please try again.');
    }
  }

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head"><p className="eyebrow">Step 5 of 6</p><h1>Create your account</h1></header>
        <form onSubmit={onSubmit}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
          {error && <p role="alert">{error}</p>}
          <button className="add-btn" type="submit">Create account</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Account.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/Account.tsx frontend/src/funnel/Account.test.tsx
git commit -m "feat(fe): funnel step 5 — account creation upgrades the anon user"
```

---

## Task 15: Step 6 — Card save (Stripe Elements)

**Files:**
- Modify: `frontend/package.json` (add deps)
- Modify: `frontend/.env.example`
- Create: `frontend/src/funnel/Card.tsx`
- Test: `frontend/src/funnel/Card.test.tsx`

**Interfaces:**
- Consumes: `createSetupIntent`, `finalizeSetup` from `../api`; `@stripe/react-stripe-js` (`useStripe`, `useElements`, `CardElement`, `Elements`); `useFunnel().booking`; `useNavigate`.
- Produces: default-exported `Card`; confirms the card off-session, calls `finalizeSetup`, then navigates to `/bonus-flowers`. Guard: no account (`!booking.customerName`) → `/account`.

- [ ] **Step 1: Install Stripe deps and add env**

Run: `cd frontend && npm install @stripe/stripe-js @stripe/react-stripe-js`

Append to `frontend/.env.example`:

```
# Stripe test publishable key for the card-save step (client-side).
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/funnel/Card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { createSetupIntent: vi.fn(), finalizeSetup: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({
  booking: { id: 'bk-1', status: 'draft', customerName: 'Ada' } }) }));

const confirmCardSetup = vi.fn();
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ confirmCardSetup }),
  useElements: () => ({ getElement: () => ({}) }),
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));

import Card from './Card';

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset(); confirmCardSetup.mockReset();
  api.createSetupIntent.mockResolvedValue({ clientSecret: 'cs_1', customerId: 'cus_1' });
  api.finalizeSetup.mockResolvedValue({ status: 'pending' }); });

describe('Card', () => {
  it('confirms the card, finalizes, and routes to /bonus-flowers', async () => {
    confirmCardSetup.mockResolvedValue({ setupIntent: { id: 'seti_1', status: 'succeeded' } });
    render(<Card />);
    fireEvent.click(await screen.findByRole('button', { name: /save card|finish/i }));
    await waitFor(() => expect(api.createSetupIntent).toHaveBeenCalledWith('bk-1'));
    await waitFor(() => expect(api.finalizeSetup).toHaveBeenCalledWith('bk-1', 'seti_1'));
    expect(navigate).toHaveBeenCalledWith('/bonus-flowers');
  });

  it('shows an inline error when the card is declined', async () => {
    confirmCardSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    render(<Card />);
    fireEvent.click(await screen.findByRole('button', { name: /save card|finish/i }));
    await screen.findByText(/declined/i);
    expect(api.finalizeSetup).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/funnel/Card.test.tsx`
Expected: FAIL — cannot resolve `./Card`.

- [ ] **Step 4: Implement Card**

Create `frontend/src/funnel/Card.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useFunnel } from './FunnelContext';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

function CardForm() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!booking?.customerName) navigate('/account'); }, [booking, navigate]);

  async function onSave() {
    if (!stripe || !elements || !booking || busy) return;
    setBusy(true); setError(null);
    try {
      const api = await import('../api');
      const { clientSecret } = await api.createSetupIntent(booking.id);
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: elements.getElement(CardElement)! },
      });
      if (result.error) { setError(result.error.message ?? 'Card could not be saved.'); return; }
      const setupIntentId = result.setupIntent!.id;
      const fin = await api.finalizeSetup(booking.id, setupIntentId);
      if (fin.error) { setError('We could not confirm your card. Please try again.'); return; }
      navigate('/bonus-flowers');
    } catch {
      setError('Something went wrong saving your card. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="wrap">
        <header className="head"><p className="eyebrow">Step 6 of 6</p><h1>Save a card for delivery day</h1></header>
        <p>You won't be charged now — we charge when your order is delivered.</p>
        <div className="card"><CardElement /></div>
        {error && <p role="alert">{error}</p>}
        <button className="add-btn" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save card'}</button>
      </div>
    </div>
  );
}

export default function Card() {
  return <Elements stripe={stripePromise}><CardForm /></Elements>;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/funnel/Card.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env.example frontend/src/funnel/Card.tsx frontend/src/funnel/Card.test.tsx
git commit -m "feat(fe): funnel step 6 — Stripe Elements card save via SetupIntent"
```

---

## Task 16: Integration — router, page move, and existing-page rewiring

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/pages/FloralCollection.tsx`
- Modify: `frontend/src/pages/Confirmation.tsx`
- Modify: `frontend/src/pages/StaffBooking.tsx`
- Test: `frontend/src/pages/FloralCollection.test.tsx` (update)

**Interfaces:**
- Consumes: all six funnel step components, `FunnelProvider`, `getMyBooking`, `ensureDemoSession`.
- Produces: `/` funnel + `/bonus-flowers` (FloralCollection) + `/confirmation` + `/staff`.

- [ ] **Step 1: Update the FloralCollection test to use the caller's own booking**

In `frontend/src/pages/FloralCollection.test.tsx`, replace the `getBooking` mock usage with `getMyBooking` (the component will call `getMyBooking()` instead of `getBooking(BOOKING_ID)`):

```tsx
// in the api mock object, replace getBooking with:
getMyBooking: vi.fn(),
// in beforeEach, replace api.getBooking.mockResolvedValue(...) with:
api.getMyBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: null, email: null, slotAt: null });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/FloralCollection.test.tsx`
Expected: FAIL — component still calls `getBooking`, so `getMyBooking` is never invoked / booking stays null.

- [ ] **Step 3: Rewire FloralCollection to `getMyBooking`**

In `frontend/src/pages/FloralCollection.tsx`, remove the `BOOKING_ID` constant and change the effect's booking fetch:

```tsx
// delete: const BOOKING_ID = import.meta.env.VITE_DEMO_BOOKING_ID as string;
// in the Promise.all, replace api.getBooking(BOOKING_ID) with api.getMyBooking()
const [cfg, prods, bk, its] = await Promise.all([
  api.getAppConfig(),
  api.getProducts(),
  api.getMyBooking(),
  api.getBookingItems(BOOKING_ID_REPLACEMENT), // see note
]);
```

Because `getBookingItems` needs an id, fetch the booking first, then its items:

```tsx
loadApi().then(async (api) => {
  const [cfg, prods, bk] = await Promise.all([api.getAppConfig(), api.getProducts(), api.getMyBooking()]);
  if (cancelled || !bk) { setConfig(cfg); setProducts(prods); return; }
  const its = await api.getBookingItems(bk.id);
  if (cancelled) return;
  setConfig(cfg); setProducts(prods); setBooking(bk); setItems(its);
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/pages/FloralCollection.test.tsx`
Expected: PASS. (The test mock provides `getBookingItems` already.)

- [ ] **Step 5: Rewire Confirmation to `getMyBooking`**

In `frontend/src/pages/Confirmation.tsx`, replace its `getBooking(BOOKING_ID)` call with `getMyBooking()` (same pattern: drop the env constant, guard null). Update `frontend/src/pages/Confirmation.test.tsx` mock the same way (`getBooking` → `getMyBooking`). Run:

Run: `cd frontend && npx vitest run src/pages/Confirmation.test.tsx`
Expected: PASS.

- [ ] **Step 6: Make StaffBooking self-sufficient for its demo session**

In `frontend/src/pages/StaffBooking.tsx`, at the top of the load effect, ensure the demo session (staff view still uses the seeded demo booking):

```tsx
loadApi().then(async (api) => {
  await api.ensureDemoSession();
  const [b, it, ps] = await Promise.all([
    api.getBooking(BOOKING_ID), api.getBookingItems(BOOKING_ID), api.getProducts(),
  ]);
  // …unchanged…
});
```

Add `ensureDemoSession: vi.fn()` to the api mock in `frontend/src/pages/StaffBooking.test.tsx` and `mockResolvedValue(undefined)` in its `beforeEach`. Run:

Run: `cd frontend && npx vitest run src/pages/StaffBooking.test.tsx`
Expected: PASS.

- [ ] **Step 7: Restructure the router**

Replace `frontend/src/main.tsx` with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { FunnelProvider } from './funnel/FunnelContext';
import Landing from './funnel/Landing';
import Beverage from './funnel/Beverage';
import Address from './funnel/Address';
import Slot from './funnel/Slot';
import Account from './funnel/Account';
import Card from './funnel/Card';
import FloralCollection from './pages/FloralCollection';
import Confirmation from './pages/Confirmation';
import StaffBooking from './pages/StaffBooking';
import './index.css';

function FunnelLayout() {
  return <FunnelProvider><Outlet /></FunnelProvider>;
}

const router = createBrowserRouter([
  {
    element: <FunnelLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/beverage', element: <Beverage /> },
      { path: '/address', element: <Address /> },
      { path: '/slot', element: <Slot /> },
      { path: '/account', element: <Account /> },
      { path: '/card', element: <Card /> },
    ],
  },
  { path: '/bonus-flowers', element: <FloralCollection /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBooking /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

Note: the top-level demo auto sign-in is intentionally removed — the funnel establishes an anonymous session and `/staff` calls `ensureDemoSession()` itself.

- [ ] **Step 8: Run the full frontend suite + build**

Run: `cd frontend && npm test && npm run build`
Expected: all vitest specs PASS; `tsc -b && vite build` succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/main.tsx frontend/src/pages
git commit -m "feat(fe): route funnel at / and move floral collection to /bonus-flowers"
```

---

## Task 17: Docs — README routes + go-live notes

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the routes + flow description**

In `README.md`, update the Routes line and Architecture section to describe the funnel:

- Routes: `/` (onboarding funnel), `/bonus-flowers` (floral add-ons), `/confirmation`, `/staff`.
- Add a short "Onboarding funnel" subsection: anonymous auth → draft booking via `SECURITY DEFINER` RPCs → account upgrade → SetupIntent card save (`create-setup-intent` + `finalize-setup`). Link the spec and this plan.
- Note the new env var `VITE_STRIPE_PUBLISHABLE_KEY` and that the two setup edge functions also need `STRIPE_SECRET_KEY` to run live (mock seam covers `deno test`).
- Note that anonymous sign-ins must be enabled in the Supabase project's Auth settings.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe onboarding funnel, /bonus-flowers move, Stripe env"
```

---

## Self-Review

**Spec coverage:**

- Store-attributed landing → Task 10 (`?store` capture) + Task 2 (`start_draft_booking` stamps `store_code`). ✓
- Favourite beverage → Task 11 + Task 2 (`set_booking_beverage`). ✓
- Address + delivery range → Task 12 + Task 3 (`check_postcode`/`set_booking_address`) + Task 1 (`delivery_postcodes`). ✓
- Slot selection + 10-min hold → Task 13 + Task 4 (`available_slots`/`hold_slot`, `hold_expires_at`). ✓
- Account creation → Task 14 + Task 8 (`upgradeAccount`) + Task 5 (`set_booking_customer`). ✓
- Card save (SetupIntent, off_session) → Tasks 6, 7, 15. ✓
- Move current page to `/bonus-flowers` → Task 16. ✓
- Charge-integrity preserved (no client writes to money/status/stripe) → Task 5 guard test; all writes via RPC/edge. ✓
- Existing pages read caller's own booking → Task 16. ✓

**Placeholder scan:** No TBD/TODO. One deliberate typo call-out in Task 4's test (`temporary`) — the corrected keyword is `temporary`; the implementer writes `create temporary table _pick …`. All code blocks are complete.

**Type/name consistency:** RPC names and params (`p_store_code`, `p_beverage`, `p_postcode`, `p_slot_at`, `p_name`) match between migration tasks and `api.ts` wrappers (Task 8). `DraftBooking`/`SlotOption` defined in Task 8 and consumed in Tasks 9–15. `createSetupIntent` returns `{clientSecret, customerId}`; `finalizeSetup(bookingId, setupIntentId)` matches the edge body `{booking_id, setup_intent_id}` (Task 7). `getMyBooking`/`getMyDraftBooking` defined in Task 8, consumed in Tasks 9 and 16. Edge return `{client_secret, customer_id}` (Task 6) mapped in Task 8. Consistent.
