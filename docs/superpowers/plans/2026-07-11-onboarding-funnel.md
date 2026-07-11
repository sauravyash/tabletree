# Onboarding Funnel Implementation Plan (v2 — rebased on trunk)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a six-step onboarding funnel (store landing → beverage → address+range → slot hold → account → card save) as the new front door, moving the current `FloralCollection` page from `/` to `/bonus-flowers`.

**Architecture:** Anonymous auth at the landing yields a real `user_id`; a `draft` booking accumulates funnel data through `SECURITY DEFINER` RPCs (so the browser never writes money/status/stripe columns directly). Step 5 upgrades the anon user in place. Step 6 **reuses the already-deployed** `create-setup-intent` + `save-card` edge functions and the existing `CardSave.tsx` Stripe Elements page; a `finalize_draft_booking()` RPC then flips the booking `draft → pending`. See spec: [`docs/superpowers/specs/2026-07-11-onboarding-funnel-design.md`](../specs/2026-07-11-onboarding-funnel-design.md).

**Tech Stack:** Supabase (Postgres + RLS + RPCs), Vite + React 19 + react-router-dom 7 + supabase-js, Stripe Elements (already wired). Tests: pgTAP (CI), Vitest.

## Baseline (post-rebase onto `origin/main` @ 81fb7e0)

The trunk already contains the "broader booking system" work. **Reuse, do not recreate:**
- Migrations `0001`–`0007` (incl. `0006_roles`, `0007_staff_booking_rls`). **Funnel migration is `0008`.**
- Edge functions (deployed + verified): `create-setup-intent` (`{booking_id}` → `{clientSecret}`, stamps `stripe_customer_id`) and `save-card` (`{booking_id, setup_intent_id}` → `{saved:true}` | 409 `{error}`, stamps `stripe_customer_id` + `stripe_payment_method_id`). Shared Stripe seam in `supabase/functions/_shared/`.
- `frontend/src/api.ts` already exports `createSetupIntent(bookingId)` and `saveCard(bookingId, setupIntentId)` — **do not redefine them.**
- `frontend/src/pages/CardSave.tsx` (`{ bookingId }` prop, `PaymentElement`, calls `saveCard`, then `navigate('/')`). The funnel reuses it via a new optional `onSaved` prop.
- `frontend/.env.example` already defines `VITE_STRIPE_PUBLISHABLE_KEY`; `@stripe/stripe-js` + `@stripe/react-stripe-js` already installed.
- `pgTAP` runs only in CI/Docker (unavailable here). **DB is applied to the hosted project (`ifyvsrmdnmqlqifcqpnx`) via the Supabase MCP and validated with `execute_sql` by the controller** — the migration + pgTAP files are still committed for CI/repro.

## Global Constraints

- Clients never write `status`, `coffee_price_cents`, `price_cents_snapshot`, or `stripe_*`. All funnel writes go through `SECURITY DEFINER` RPCs touching only whitelisted columns on the caller's own `draft` booking; grant `execute` to `authenticated` (anon users have this role).
- Serviceability = postcode allowlist (`app_config.delivery_postcodes`). No geocoding.
- Slots computed from `app_config.slot_schedule` (no slots table). Server timezone authoritative.
- 10-minute hold = `bookings.hold_expires_at`; `hold_slot` is the atomic capacity gate.
- Reuse existing edge functions + `CardSave.tsx`; add nothing that duplicates them.
- Status vocabulary: `draft`, `pending`, `delivered`, `payment_failed` (verify existing rows before adding a CHECK).
- Frontend test idiom: `vi.mock('../api', …)` + `vi.mock('react-router-dom', …)`; components import `../api` lazily via `import('../api')` inside effects/handlers to dodge vitest hoisting TDZ.

---

## File Structure

**Database (`supabase/`):**
- Create `migrations/0008_funnel.sql` — funnel columns, status CHECK, 8 RPCs, grants, config rows.
- Create `tests/0006_funnel_schema_test.sql`, `0007_draft_beverage_test.sql`, `0008_address_test.sql`, `0009_slots_test.sql`, `0010_customer_finalize_test.sql`.

**Frontend (`frontend/src/`):**
- Modify `types.ts` — add `DraftBooking`, `SlotOption`.
- Modify `api.ts` + `api.test.ts` — anon-session/RPC wrappers + `getMyBooking`/`getMyDraftBooking`/`getConfigList`/`finalizeDraftBooking`. (Do NOT touch `createSetupIntent`/`saveCard`.)
- Create `funnel/FunnelContext.tsx` (+ test), `funnel/Landing.tsx`, `Beverage.tsx`, `Address.tsx`, `Slot.tsx`, `Account.tsx`, `Card.tsx` (each + test).
- Modify `pages/CardSave.tsx` — add optional `onSaved?: (bookingId: string) => void | Promise<void>` prop (default = current `navigate('/')`).
- Modify `main.tsx` — `FunnelLayout` + funnel routes; move `FloralCollection` to `/bonus-flowers`.
- Modify `pages/FloralCollection.tsx`, `pages/Confirmation.tsx` — read the caller's own booking via `getMyBooking()`.

---

## Task 1: Migration `0008` — columns, status CHECK, config  *(controller applies to hosted via MCP)*

**Files:** Create `supabase/migrations/0008_funnel.sql`; Test `supabase/tests/0006_funnel_schema_test.sql`.

**Interfaces:** Produces `bookings` columns `store_code, beverage, address_line1, address_line2, suburb, postcode, hold_expires_at`; status CHECK; `app_config` keys `delivery_postcodes`, `beverage_options`, `slot_schedule`.

- [ ] **Step 1: Write the pgTAP test (CI/repro)**

Create `supabase/tests/0006_funnel_schema_test.sql`:

```sql
begin;
select plan(3);
select has_column('bookings', 'store_code', 'bookings has store_code');
select has_column('bookings', 'hold_expires_at', 'bookings has hold_expires_at');
select is(
  (select count(*)::int from app_config
     where key in ('delivery_postcodes','beverage_options','slot_schedule')),
  3, 'three funnel config rows seeded');
select * from finish();
rollback;
```

- [ ] **Step 2: Write the migration (columns + config; RPCs appended in Tasks 2–5)**

Create `supabase/migrations/0008_funnel.sql`:

```sql
-- Funnel: draft-booking columns + config. RPCs appended below (Tasks 2-5).
alter table bookings
  add column if not exists store_code      text,
  add column if not exists beverage        text,
  add column if not exists address_line1   text,
  add column if not exists address_line2   text,
  add column if not exists suburb          text,
  add column if not exists postcode        text,
  add column if not exists hold_expires_at timestamptz;

-- Status vocabulary. Controller confirms existing rows comply before adding
-- (run: select distinct status from bookings;).
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('draft','pending','delivered','payment_failed'));

insert into app_config (key, value) values
  ('delivery_postcodes', '["2017","2018","2021","2031","2032"]'::jsonb),
  ('beverage_options',   '["Flat white","Latte","Cappuccino","Long black","Tea"]'::jsonb),
  ('slot_schedule',      '{"weekdays":[1,2,3,4,5,6,7],"startHour":9,"endHour":17,"slotMinutes":60,"capacity":3,"horizonDays":7}'::jsonb)
on conflict (key) do nothing;
```

- [ ] **Step 3: Controller applies + validates against hosted project**

Via the Supabase MCP (ref `ifyvsrmdnmqlqifcqpnx`): (1) `execute_sql` `select distinct status from bookings;` — confirm all ∈ CHECK set (else widen); (2) `apply_migration` `0008_funnel`; (3) `execute_sql` `select count(*) from app_config where key in ('delivery_postcodes','beverage_options','slot_schedule');` → 3.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_funnel.sql supabase/tests/0006_funnel_schema_test.sql
git commit -m "feat(db): funnel booking columns, status check, config (0008)"
```

---

## Task 2: `start_draft_booking` + `set_booking_beverage` RPCs

**Files:** Modify `supabase/migrations/0008_funnel.sql` (append); Test `supabase/tests/0007_draft_beverage_test.sql`.

**Interfaces:** Produces `start_draft_booking(p_store_code text) returns uuid`; `set_booking_beverage(p_beverage text) returns void`. `SECURITY DEFINER`; `execute` to `authenticated`.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/0007_draft_beverage_test.sql`:

```sql
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
```

- [ ] **Step 2: Append the RPCs**

Append to `supabase/migrations/0008_funnel.sql`:

```sql
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

grant execute on function start_draft_booking(text) to authenticated;
grant execute on function set_booking_beverage(text) to authenticated;
```

- [ ] **Step 3: Controller applies + validates** — re-`apply_migration` `0008_funnel` (full file so far); validate via `execute_sql` in a rolled-back transaction using `set local role authenticated` + `set_config('request.jwt.claims', …)` with the seeded demo user id.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_funnel.sql supabase/tests/0007_draft_beverage_test.sql
git commit -m "feat(db): start_draft_booking + set_booking_beverage RPCs"
```

---

## Task 3: `check_postcode` + `set_booking_address` RPCs

**Files:** Modify `supabase/migrations/0008_funnel.sql` (append); Test `supabase/tests/0008_address_test.sql`.

**Interfaces:** Produces `check_postcode(p_postcode text) returns boolean`; `set_booking_address(p_line1 text, p_line2 text, p_suburb text, p_postcode text) returns boolean`.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/0008_address_test.sql`:

```sql
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
```

- [ ] **Step 2: Append the RPCs**

Append to `supabase/migrations/0008_funnel.sql`:

```sql
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

grant execute on function check_postcode(text) to authenticated;
grant execute on function set_booking_address(text, text, text, text) to authenticated;
```

- [ ] **Step 3: Controller applies + validates** — re-`apply_migration`; `execute_sql` spot-check allow/deny + persisted suburb.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_funnel.sql supabase/tests/0008_address_test.sql
git commit -m "feat(db): check_postcode + set_booking_address RPCs"
```

---

## Task 4: `available_slots` + `hold_slot` RPCs

**Files:** Modify `supabase/migrations/0008_funnel.sql` (append); Test `supabase/tests/0009_slots_test.sql`.

**Interfaces:** Produces `available_slots() returns table(slot_at timestamptz, remaining int)`; `hold_slot(p_slot_at timestamptz) returns boolean`.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/0009_slots_test.sql`:

```sql
begin;
select plan(4);
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","email":"demo@tabletree.test"}', true);
$$;
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
```

- [ ] **Step 2: Append the RPCs**

Append to `supabase/migrations/0008_funnel.sql`:

```sql
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

grant execute on function available_slots() to authenticated;
grant execute on function hold_slot(timestamptz) to authenticated;
```

- [ ] **Step 3: Controller applies + validates** — re-`apply_migration`; `execute_sql`: `available_slots()` returns rows and a hold decrements a slot's `remaining`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_funnel.sql supabase/tests/0009_slots_test.sql
git commit -m "feat(db): available_slots + hold_slot RPCs with capacity gate"
```

---

## Task 5: `set_booking_customer` + `finalize_draft_booking` RPCs

**Files:** Modify `supabase/migrations/0008_funnel.sql` (append); Test `supabase/tests/0010_customer_finalize_test.sql`.

**Interfaces:** Produces `set_booking_customer(p_name text) returns void`; `finalize_draft_booking() returns void` (draft→pending, only when `stripe_payment_method_id` is set).

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/0010_customer_finalize_test.sql`:

```sql
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
```

- [ ] **Step 2: Append the RPCs**

Append to `supabase/migrations/0008_funnel.sql`:

```sql
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

grant execute on function set_booking_customer(text) to authenticated;
grant execute on function finalize_draft_booking() to authenticated;
```

- [ ] **Step 3: Controller applies + validates** — re-`apply_migration` full file; `execute_sql`: name set, email stamped, finalize refuses without card then flips with card; assert a direct client `update bookings …` is denied by RLS (charge integrity).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_funnel.sql supabase/tests/0010_customer_finalize_test.sql
git commit -m "feat(db): set_booking_customer + finalize_draft_booking RPCs"
```

---

## Task 6: Frontend types + `api.ts` funnel surface

**Files:** Modify `frontend/src/types.ts`, `frontend/src/api.ts`; Test `frontend/src/api.test.ts` (append).

**Interfaces:**
- Types: `DraftBooking`, `SlotOption`.
- api: `ensureAnonSession()`, `startDraftBooking(storeCode)`, `setBeverage(b)`, `checkPostcode(pc)`, `setAddress(a)`, `availableSlots()`, `holdSlot(slotAt)`, `upgradeAccount(email,password)`, `setCustomer(name)`, `finalizeDraftBooking()`, `getConfigList(key)`, `getMyBooking()`, `getMyDraftBooking()`. **Does NOT touch `createSetupIntent`/`saveCard`.**

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/api.test.ts`. Replace the existing single `vi.mock('./supabase', …)` with one richer mock adding `rpc` + `auth` (do NOT declare `vi.mock('./supabase')` twice):

```ts
const rpc = vi.fn();
const auth = { getSession: vi.fn(), signInAnonymously: vi.fn(), updateUser: vi.fn() };
// merged mock (replaces the existing one):
// vi.mock('./supabase', () => ({ supabase: { from:(...a)=>from(...a),
//   functions:{invoke:(...a)=>invoke(...a)}, rpc:(...a)=>rpc(...a), auth } }));
```

Add cases:

```ts
import { startDraftBooking, checkPostcode, availableSlots, holdSlot, getConfigList } from './api';

describe('startDraftBooking', () => {
  it('calls the RPC and returns the id', async () => {
    rpc.mockResolvedValue({ data: 'bk-1', error: null });
    expect(await startDraftBooking('SHOP42')).toBe('bk-1');
    expect(rpc).toHaveBeenCalledWith('start_draft_booking', { p_store_code: 'SHOP42' });
  });
});
describe('checkPostcode', () => {
  it('returns the boolean', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkPostcode('2017')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('check_postcode', { p_postcode: '2017' });
  });
});
describe('availableSlots', () => {
  it('maps rows to camelCase', async () => {
    rpc.mockResolvedValue({ data: [{ slot_at: '2026-07-12T09:00:00Z', remaining: 2 }], error: null });
    expect(await availableSlots()).toEqual([{ slotAt: '2026-07-12T09:00:00Z', remaining: 2 }]);
  });
});
describe('holdSlot', () => {
  it('returns the boolean', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await holdSlot('2026-07-12T09:00:00Z')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('hold_slot', { p_slot_at: '2026-07-12T09:00:00Z' });
  });
});
describe('getConfigList', () => {
  it('returns the array value for a key', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { value: ['Latte', 'Tea'] }, error: null }) }) }) });
    expect(await getConfigList('beverage_options')).toEqual(['Latte', 'Tea']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run src/api.test.ts` → FAIL (`startDraftBooking is not a function`).

- [ ] **Step 3: Extend types**

Append to `frontend/src/types.ts`:

```ts
export interface DraftBooking {
  id: string; storeCode: string | null; beverage: string | null;
  addressLine1: string | null; addressLine2: string | null;
  suburb: string | null; postcode: string | null;
  slotAt: string | null; holdExpiresAt: string | null;
  customerName: string | null; email: string | null; status: string;
}
export interface SlotOption { slotAt: string; remaining: number }
```

- [ ] **Step 4: Add the api functions**

Add `DraftBooking, SlotOption` to the existing `import type { … } from './types'` line, then append to `frontend/src/api.ts`:

```ts
export async function ensureAnonSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
export async function startDraftBooking(storeCode: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('start_draft_booking', { p_store_code: storeCode });
  if (error) throw error; return data as string;
}
export async function setBeverage(beverage: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_beverage', { p_beverage: beverage });
  if (error) throw error;
}
export async function checkPostcode(postcode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_postcode', { p_postcode: postcode });
  if (error) throw error; return data as boolean;
}
export async function setAddress(a: { line1: string; line2: string; suburb: string; postcode: string }): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_booking_address', {
    p_line1: a.line1, p_line2: a.line2, p_suburb: a.suburb, p_postcode: a.postcode });
  if (error) throw error; return data as boolean;
}
export async function availableSlots(): Promise<SlotOption[]> {
  const { data, error } = await supabase.rpc('available_slots');
  if (error) throw error;
  return (data ?? []).map((r: any): SlotOption => ({ slotAt: r.slot_at, remaining: r.remaining }));
}
export async function holdSlot(slotAt: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('hold_slot', { p_slot_at: slotAt });
  if (error) throw error; return data as boolean;
}
export async function upgradeAccount(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) throw error;
}
export async function setCustomer(name: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_customer', { p_name: name });
  if (error) throw error;
}
export async function finalizeDraftBooking(): Promise<void> {
  const { error } = await supabase.rpc('finalize_draft_booking');
  if (error) throw error;
}
export async function getConfigList(key: string): Promise<string[]> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
  if (error) throw error; return (data?.value as string[]) ?? [];
}
function mapDraft(b: any): DraftBooking {
  return { id: b.id, storeCode: b.store_code, beverage: b.beverage,
    addressLine1: b.address_line1, addressLine2: b.address_line2, suburb: b.suburb,
    postcode: b.postcode, slotAt: b.slot_at, holdExpiresAt: b.hold_expires_at,
    customerName: b.customer_name, email: b.email, status: b.status };
}
export async function getMyDraftBooking(): Promise<DraftBooking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data ? mapDraft(data) : null;
}
export async function getMyBooking(): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data ? mapBooking(data) : null;
}
```

- [ ] **Step 5: Run to verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(fe): funnel api surface (anon session, RPC wrappers, my-booking)"
```

---

## Task 7: `FunnelContext` provider + `useFunnel`

**Files:** Create `frontend/src/funnel/FunnelContext.tsx` (+ `FunnelContext.test.tsx`).

**Interfaces:** Consumes `ensureAnonSession`, `getMyDraftBooking`. Produces `<FunnelProvider>` + `useFunnel(): { booking: DraftBooking | null; loading: boolean; refresh(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/FunnelContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
const api = { ensureAnonSession: vi.fn(), getMyDraftBooking: vi.fn() };
vi.mock('../api', () => api);
import { FunnelProvider, useFunnel } from './FunnelContext';
function Probe() { const { booking, loading } = useFunnel();
  return <div>{loading ? 'loading' : `booking:${booking?.id ?? 'none'}`}</div>; }
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.ensureAnonSession.mockResolvedValue(undefined); });
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

- [ ] **Step 2: Run to verify it fails** — FAIL (unresolved).

- [ ] **Step 3: Implement**

Create `frontend/src/funnel/FunnelContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DraftBooking } from '../types';

interface FunnelValue { booking: DraftBooking | null; loading: boolean; refresh: () => Promise<void>; }
const FunnelCtx = createContext<FunnelValue | null>(null);

export function useFunnel(): FunnelValue {
  const v = useContext(FunnelCtx);
  if (!v) throw new Error('useFunnel must be used within FunnelProvider');
  return v;
}

export function FunnelProvider({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<DraftBooking | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() { const api = await import('../api'); setBooking(await api.getMyDraftBooking()); }
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

- [ ] **Step 4: Run to verify it passes** — PASS (2/2).

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): FunnelProvider hydrates draft booking after ensuring a session"`

---

## Task 8: Step 1 — Landing

**Files:** Create `frontend/src/funnel/Landing.tsx` (+ test).

**Interfaces:** Consumes `startDraftBooking`; `useFunnel().refresh`; `useSearchParams`, `useNavigate`. CTA → `/beverage`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Landing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { startDraftBooking: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams('store=SHOP42')] }));
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
    fireEvent.click(await screen.findByRole('button', { name: /get started/i }));
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

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
    <div className="screen"><div className="wrap">
      <header className="head">
        <p className="eyebrow">Fresh flowers with your coffee</p>
        <h1>Let's set up your delivery</h1>
        <p>A few quick steps and your first Table Tree is on its way.</p>
      </header>
      <button className="add-btn" onClick={() => navigate('/beverage')}>Get started</button>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2/2).

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): funnel step 1 — store-attributed landing"`

---

## Task 9: Step 2 — Beverage

**Files:** Create `frontend/src/funnel/Beverage.tsx` (+ test).

**Interfaces:** Consumes `getConfigList('beverage_options')`, `setBeverage`; `useFunnel().booking`; `useNavigate`. Guard no draft → `/`. Continue → `set_booking_beverage` (if chosen) then `/address`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

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
    import('../api').then(async (api) => { const o = await api.getConfigList('beverage_options'); if (!cancelled) setOptions(o); });
    return () => { cancelled = true; };
  }, [booking, navigate]);
  async function onContinue() {
    if (choice) { const api = await import('../api'); await api.setBeverage(choice); }
    navigate('/address');
  }
  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 2 of 6</p><h1>What's your usual?</h1></header>
      <div className="sizes">
        {options.map((o) => (
          <button key={o} className="size-btn" aria-pressed={choice === o} onClick={() => setChoice(o)}>{o}</button>
        ))}
      </div>
      <button className="add-btn" onClick={onContinue}>Continue</button>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): funnel step 2 — beverage preference"`

---

## Task 10: Step 3 — Address + range check

**Files:** Create `frontend/src/funnel/Address.tsx` (+ test).

**Interfaces:** Consumes `setAddress`; `useFunnel().booking + refresh`; `useNavigate`. In-range → `refresh` + `/slot`; out-of-range → inline message, no nav. Guard no draft → `/`.

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
  fireEvent.change(screen.getByLabelText(/postcode/i), { target: { value: '2017' } });
}
beforeEach(() => { api.setAddress.mockReset(); navigate.mockReset(); refresh.mockReset(); });
describe('Address', () => {
  it('advances to /slot when in range', async () => {
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

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/funnel/Address.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Address() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [line1, setLine1] = useState(''); const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState(''); const [postcode, setPostcode] = useState('');
  const [outOfRange, setOutOfRange] = useState(false);
  useEffect(() => { if (!booking) navigate('/'); }, [booking, navigate]);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setOutOfRange(false);
    const api = await import('../api');
    const ok = await api.setAddress({ line1, line2, suburb, postcode });
    if (!ok) { setOutOfRange(true); return; }
    await refresh(); navigate('/slot');
  }
  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 3 of 6</p><h1>Where should we deliver?</h1></header>
      <form onSubmit={onSubmit}>
        <label>Address line 1<input value={line1} onChange={(e) => setLine1(e.target.value)} required /></label>
        <label>Address line 2<input value={line2} onChange={(e) => setLine2(e.target.value)} /></label>
        <label>Suburb<input value={suburb} onChange={(e) => setSuburb(e.target.value)} required /></label>
        <label>Postcode<input value={postcode} onChange={(e) => setPostcode(e.target.value)} required /></label>
        {outOfRange && <p role="alert">Sorry — that's not in our delivery area yet.</p>}
        <button className="add-btn" type="submit">Continue</button>
      </form>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2/2).

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): funnel step 3 — address entry with delivery-range check"`

---

## Task 11: Step 4 — Slot selection + hold

**Files:** Create `frontend/src/funnel/Slot.tsx` (+ test).

**Interfaces:** Consumes `availableSlots`, `holdSlot`; `useFunnel().booking + refresh`; `useNavigate`. Pick → `holdSlot`; true → `refresh` + `/account`; false → "just taken" + refresh list. Guard `!booking.postcode` → `/address`.

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
  booking: { id: 'bk-1', status: 'draft', postcode: '2017' }, refresh }) }));
import Slot from './Slot';
const slots = [{ slotAt: '2026-07-12T09:00:00Z', remaining: 2 }, { slotAt: '2026-07-12T10:00:00Z', remaining: 1 }];
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset(); refresh.mockReset();
  api.availableSlots.mockResolvedValue(slots); });
describe('Slot', () => {
  it('holds a picked slot and advances to /account', async () => {
    api.holdSlot.mockResolvedValue(true);
    render(<Slot />);
    fireEvent.click((await screen.findAllByRole('button'))[0]);
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith('2026-07-12T09:00:00Z'));
    expect(navigate).toHaveBeenCalledWith('/account');
  });
  it('shows a message and refreshes when the slot was just taken', async () => {
    api.holdSlot.mockResolvedValue(false);
    render(<Slot />);
    fireEvent.click((await screen.findAllByRole('button'))[0]);
    await screen.findByText(/just taken/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(api.availableSlots).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

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
  const load = useCallback(async () => { const api = await import('../api'); setSlots(await api.availableSlots()); }, []);
  useEffect(() => { if (!booking?.postcode) { navigate('/address'); return; } load(); }, [booking, navigate, load]);
  async function pick(slotAt: string) {
    setTaken(false);
    const api = await import('../api');
    const ok = await api.holdSlot(slotAt);
    if (!ok) { setTaken(true); await load(); return; }
    await refresh(); navigate('/account');
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 4 of 6</p><h1>Pick a delivery slot</h1></header>
      {taken && <p role="alert">That slot was just taken — please pick another.</p>}
      <div className="sizes">
        {slots.map((s) => (
          <button key={s.slotAt} className="size-btn" onClick={() => pick(s.slotAt)}>{fmt(s.slotAt)} · {s.remaining} left</button>
        ))}
      </div>
      <p className="helper">We'll hold your slot for 10 minutes while you finish signing up.</p>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2/2).

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): funnel step 4 — slot selection with server-held capacity"`

---

## Task 12: Step 5 — Account creation

**Files:** Create `frontend/src/funnel/Account.tsx` (+ test).

**Interfaces:** Consumes `upgradeAccount`, `setCustomer`; `useFunnel().booking + refresh`; `useNavigate`. Submit → upgrade → stamp name → `refresh` + `/card`. "already registered" inline. Guard no live hold → `/slot`.

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
  booking: { id: 'bk-1', status: 'draft', postcode: '2017', holdExpiresAt: future }, refresh }) }));
import Account from './Account';
function fill() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@x.co' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter2hunter2' } });
}
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset(); refresh.mockReset(); });
describe('Account', () => {
  it('upgrades, stamps the name, and advances to /card', async () => {
    api.upgradeAccount.mockResolvedValue(undefined); api.setCustomer.mockResolvedValue(undefined);
    render(<Account />); fill();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(api.upgradeAccount).toHaveBeenCalledWith('ada@x.co', 'hunter2hunter2'));
    expect(api.setCustomer).toHaveBeenCalledWith('Ada');
    expect(navigate).toHaveBeenCalledWith('/card');
  });
  it('shows an inline error when the email is already registered', async () => {
    api.upgradeAccount.mockRejectedValue(new Error('email address already in use'));
    render(<Account />); fill();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await screen.findByText(/already registered|already in use/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/funnel/Account.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Account() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const live = booking?.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() > Date.now();
    if (!live) navigate('/slot');
  }, [booking, navigate]);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const api = await import('../api');
      await api.upgradeAccount(email, password);
      await api.setCustomer(name);
      await refresh(); navigate('/card');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      setError(/already|use|registered/i.test(msg)
        ? 'That email is already registered — try another.'
        : 'Could not create your account. Please try again.');
    }
  }
  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 5 of 6</p><h1>Create your account</h1></header>
      <form onSubmit={onSubmit}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
        {error && <p role="alert">{error}</p>}
        <button className="add-btn" type="submit">Create account</button>
      </form>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2/2).

- [ ] **Step 5: Commit** — `git commit -m "feat(fe): funnel step 5 — account creation upgrades the anon user"`

---

## Task 13: Step 6 — Card (reuse `CardSave`)

**Files:** Modify `frontend/src/pages/CardSave.tsx` (add optional `onSaved` prop); Create `frontend/src/funnel/Card.tsx` (+ test).

**Interfaces:**
- `CardSave` gains `onSaved?: (bookingId: string) => void | Promise<void>` — when provided, called after a successful `saveCard` **instead of** the default `navigate('/')`.
- `funnel/Card.tsx`: reads `useFunnel().booking`, guards `!booking.customerName` → `/account`, renders `<CardSave bookingId={booking.id} onSaved={…}/>` where `onSaved` calls `finalizeDraftBooking()` then `navigate('/bonus-flowers')`.

- [ ] **Step 1: Add the optional prop to CardSave (keep default behavior)**

In `frontend/src/pages/CardSave.tsx`, thread an optional `onSaved` through both components:

```tsx
function CardForm({ bookingId, onSaved }: { bookingId: string; onSaved?: (id: string) => void | Promise<void> }) {
  // …unchanged up to the try block…
    try {
      await saveCard(bookingId, setupIntent.id);
      if (onSaved) { await onSaved(bookingId); } else { navigate('/'); }
    } catch {
      setError('Card confirmed but saving failed. Please try again.'); setWorking(false);
    }
  // …
}

export default function CardSave({ bookingId, onSaved }: { bookingId: string; onSaved?: (id: string) => void | Promise<void> }) {
  // …unchanged; pass onSaved down: <CardForm bookingId={bookingId} onSaved={onSaved} />
}
```

The existing `CardSave.test.tsx` still passes (no `onSaved` → default `navigate('/')`).

- [ ] **Step 2: Write the failing funnel-Card test**

Create `frontend/src/funnel/Card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { finalizeDraftBooking: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft', customerName: 'Ada' } }) }));
// Stub CardSave to synchronously invoke onSaved, isolating the funnel wrapper's wiring.
vi.mock('../pages/CardSave', () => ({ default: ({ bookingId, onSaved }: any) =>
  <button onClick={() => onSaved?.(bookingId)}>save card</button> }));
import Card from './Card';
beforeEach(() => { api.finalizeDraftBooking.mockReset(); navigate.mockReset();
  api.finalizeDraftBooking.mockResolvedValue(undefined); });
describe('funnel Card', () => {
  it('finalizes the booking and routes to /bonus-flowers after save', async () => {
    render(<Card />);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    await waitFor(() => expect(api.finalizeDraftBooking).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/bonus-flowers');
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/funnel/Card.test.tsx` → FAIL (unresolved `./Card`).

- [ ] **Step 4: Implement**

Create `frontend/src/funnel/Card.tsx`:

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import CardSave from '../pages/CardSave';

export default function Card() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  useEffect(() => { if (booking && !booking.customerName) navigate('/account'); }, [booking, navigate]);
  if (!booking) return null;
  async function onSaved() {
    const api = await import('../api');
    await api.finalizeDraftBooking();
    navigate('/bonus-flowers');
  }
  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 6 of 6</p><h1>Save a card for delivery day</h1></header>
      <p>You won't be charged now — we charge when your order is delivered.</p>
      <CardSave bookingId={booking.id} onSaved={onSaved} />
    </div></div>
  );
}
```

- [ ] **Step 5: Run to verify it passes** — PASS. Re-run `npx vitest run src/pages/CardSave.test.tsx` → still PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CardSave.tsx frontend/src/funnel/Card.tsx frontend/src/funnel/Card.test.tsx
git commit -m "feat(fe): funnel step 6 — reuse CardSave, finalize draft to pending"
```

---

## Task 14: Integration — router, page move, existing-page rewiring

**Files:** Modify `frontend/src/main.tsx`, `frontend/src/pages/FloralCollection.tsx`, `frontend/src/pages/Confirmation.tsx`; update `frontend/src/pages/FloralCollection.test.tsx`, `frontend/src/pages/Confirmation.test.tsx`.

**Interfaces:** Consumes all funnel steps + `FunnelProvider` + `getMyBooking`. Produces `/` funnel + `/bonus-flowers` + `/confirmation` + `/staff` routes.

- [ ] **Step 1: Rewire FloralCollection to `getMyBooking` (test first)**

In `frontend/src/pages/FloralCollection.test.tsx`: in the api mock replace `getBooking` with `getMyBooking`, and in `beforeEach` set `api.getMyBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: null, email: null, slotAt: null })`.

Run: `cd frontend && npx vitest run src/pages/FloralCollection.test.tsx` → FAIL.

In `frontend/src/pages/FloralCollection.tsx`: drop the `BOOKING_ID` env constant; fetch booking first, then items:

```tsx
loadApi().then(async (api) => {
  const [cfg, prods, bk] = await Promise.all([api.getAppConfig(), api.getProducts(), api.getMyBooking()]);
  if (cancelled) return;
  setConfig(cfg); setProducts(prods);
  if (!bk) return;
  const its = await api.getBookingItems(bk.id);
  if (cancelled) return;
  setBooking(bk); setItems(its);
});
```

Run again → PASS.

- [ ] **Step 2: Rewire Confirmation to `getMyBooking` (test first)**

Mirror Step 1 for `frontend/src/pages/Confirmation.tsx` + its test (`getBooking` → `getMyBooking`, drop env id, guard null). Run `npx vitest run src/pages/Confirmation.test.tsx` → PASS.

- [ ] **Step 3: Restructure the router**

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
import StaffBookings from './pages/StaffBookings';
import './index.css';

function FunnelLayout() { return <FunnelProvider><Outlet /></FunnelProvider>; }

const router = createBrowserRouter([
  { element: <FunnelLayout />, children: [
    { path: '/', element: <Landing /> },
    { path: '/beverage', element: <Beverage /> },
    { path: '/address', element: <Address /> },
    { path: '/slot', element: <Slot /> },
    { path: '/account', element: <Account /> },
    { path: '/card', element: <Card /> },
  ] },
  { path: '/bonus-flowers', element: <FloralCollection /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBookings /> },
  { path: '/staff/:bookingId', element: <StaffBookings /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
```

Note: the old top-level demo auto sign-in and the standalone `/card` demo route are removed — the funnel establishes an anonymous session and owns `/card`; `/staff` retains its own sign-in gate inside `StaffBookings`.

- [ ] **Step 4: Full suite + build**

Run: `cd frontend && npm test && npm run build`
Expected: all vitest specs PASS; `tsc -b && vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.tsx frontend/src/pages/FloralCollection.tsx frontend/src/pages/FloralCollection.test.tsx frontend/src/pages/Confirmation.tsx frontend/src/pages/Confirmation.test.tsx
git commit -m "feat(fe): route funnel at / and move floral collection to /bonus-flowers"
```

---

## Task 15: Docs — README

**Files:** Modify `README.md`.

- [ ] **Step 1: Update routes + add a funnel section**

Routes line → `/` (onboarding funnel), `/bonus-flowers` (floral add-ons), `/confirmation`, `/staff`. Add an "Onboarding funnel" subsection: anonymous auth → draft booking via `SECURITY DEFINER` RPCs (migration `0008`) → account upgrade → reuse `create-setup-intent` + `save-card` + `CardSave` → `finalize_draft_booking` flips to `pending`. Note: anonymous sign-ins must be enabled in Supabase Auth settings; `VITE_STRIPE_PUBLISHABLE_KEY` required for the card step. Link the spec + this plan.

- [ ] **Step 2: Commit** — `git commit -m "docs: onboarding funnel + /bonus-flowers move"`

---

## Self-Review

**Spec coverage:** landing/store → Task 8 + Task 2; beverage → Task 9 + Task 2; address+range → Task 10 + Task 3; slot+hold → Task 11 + Task 4; account → Task 12 + Task 5/6; card save → Task 13 (reuse `create-setup-intent`/`save-card`/`CardSave`) + `finalize_draft_booking` (Task 5); page move → Task 14. ✓

**Reuse (no duplication):** edge functions, `createSetupIntent`/`saveCard`, and `CardSave.tsx` are reused, not recreated; `api.ts` additions exclude them. ✓

**Numbering:** migration `0008`; pgTAP tests `0006`–`0010` (after existing `0005_staff_rls_test.sql`). ✓

**Type/name consistency:** RPC params (`p_store_code`, `p_beverage`, `p_postcode`, `p_slot_at`, `p_name`) match `api.ts` wrappers; `DraftBooking`/`SlotOption` defined in Task 6, consumed in Tasks 7–13; `onSaved` prop signature consistent between Task 13's CardSave edit and `funnel/Card.tsx`. ✓

**Environment:** DB tasks applied to the hosted project via MCP by the controller (no local Docker); frontend tasks run under vitest. ✓
