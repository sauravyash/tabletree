# Floral Cup Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional floral add-on step to the coffee-delivery booking flow, charged with the coffee in one off-session Stripe PaymentIntent at delivery.

**Architecture:** Supabase-native. The browser reads catalog data and adds/removes floral line items directly via `supabase-js`; a `BEFORE INSERT` trigger enforces the feature flag and stamps price/option snapshots server-side so direct writes can't be spoofed. A `deliver-booking` Edge Function (Deno + Stripe, service-role) performs the charge. A Vite/React/TS frontend renders the collection, confirmation, and staff pages.

**Tech Stack:** Supabase CLI + local Postgres (Docker), pgTAP for DB tests, Deno for the Edge Function, Vite + React 18 + TypeScript + react-router + Vitest/RTL for the frontend, Stripe (test mode).

## Global Constraints

- **Two products only.** Table Tree (S/M/L) and Living Room Box Bouquet (MD/LG). Table Tree Minimalist is **shelved — never render or seed it.**
- **Table Tree invariants:** exactly 1 flower, coffee-cup vessel, foliage included; only foliage volume varies by size. Flower count never changes.
- **Box Bouquet:** MD = 3 flowers, LG = 5 flowers; optional handle (`with`/`without`), Box only; flower count fixed per size; no add-extra-flower.
- **Pricing is placeholder.** `price_cents` is nullable; UI shows `$—` while unpriced.
- **Preview-only by default:** `app_config.floral_purchase_enabled` defaults to `false`. Adds are rejected server-side until the flag is on AND the variant is priced.
- **Free tabletree** is fixed & independent: `bookings.redemption_token`, shown on Confirmation. No discount logic.
- **Snapshots:** `price_cents_snapshot` and `option_snapshot` are set by the trigger from the server-side variant, never trusted from the client.
- **Mobile-first** UI (users arrive via QR on phones).
- **Fixed demo IDs:** demo user `00000000-0000-0000-0000-0000000000aa`, demo booking `00000000-0000-0000-0000-000000000001`.
- **Copy (verbatim):** header eyebrow "Before your delivery arrives", H1 "Add something for the table?", Table Tree tagline "One statement flower, everything in a cup", Box tagline "A larger arrangement for the living space", skip button "No thanks, continue", disclaimer "Pricing shown is a placeholder — final pricing TBD."

---

## File Structure

```
supabase/
  config.toml                      (from `supabase init`)
  migrations/
    0001_schema.sql                tables + app_config
    0002_rls.sql                   row-level security policies
    0003_guard_trigger.sql         BEFORE INSERT guard + snapshot on booking_items
  tests/
    0001_schema_test.sql           pgTAP: tables/columns exist
    0002_rls_test.sql              pgTAP: cross-user isolation
    0003_guard_trigger_test.sql    pgTAP: gating + snapshot behavior
  seed.sql                         app_config, 2 products/variants/options, demo user, demo booking
  seed_stripe.ts                   Deno: create test customer + attach pm_card_visa, write onto demo booking
  functions/
    deliver-booking/
      index.ts                     HTTP handler: sum + charge + status update
      stripe.ts                    StripeGateway interface, RealStripe, FakeStripe
      deliver.ts                   pure charge logic (testable, no network)
      deliver_test.ts              Deno test for deliver.ts
frontend/
  index.html, package.json, tsconfig.json, vite.config.ts, .env.example
  src/
    main.tsx                       router + demo sign-in bootstrap
    supabase.ts                    supabase-js client
    types.ts                       shared TS types
    api.ts                         typed read/write helpers + deliverBooking()
    api.test.ts                    Vitest: api helpers call supabase-js correctly
    money.ts                       formatPrice(cents|null, pricingMode)
    money.test.ts                  Vitest: $— vs $NN
    pages/
      FloralCollection.tsx         the add-on page (ported design)
      FloralCollection.test.tsx    Vitest/RTL: preview-only + add/remove
      Confirmation.tsx             summary + redemption token
      Confirmation.test.tsx
      StaffBooking.tsx             line items + Mark delivered
      StaffBooking.test.tsx
    components/
      ProductCard.tsx, SizeSelector.tsx, HandleToggle.tsx, ContinueBar.tsx
```

Root `index.html` (Karminal thank-you) is untouched. The prototype `floral-collection.html` is ported into `FloralCollection.tsx` then deleted (Task 7).

---

## Interfaces (shared contract used across tasks)

`frontend/src/types.ts` (produced in Task 6, consumed by Tasks 6–10):

```ts
export type PricingMode = 'placeholder' | 'sample';

export interface VariantOption { key: string; value: string }

export interface Variant {
  id: string;
  productId: string;
  size: string;           // 'S'|'M'|'L'|'MD'|'LG'
  flowerCount: number;
  foliageLevel: string;
  priceCents: number | null;
  options: VariantOption[];
}

export interface Product {
  id: string; name: string; slug: string; description: string | null;
  variants: Variant[];
}

export interface Booking {
  id: string; customerName: string | null; email: string | null;
  slotAt: string | null; coffeePriceCents: number | null;
  redemptionToken: string; status: string;
}

export interface BookingItem {
  id: string; bookingId: string; variantId: string;
  optionSnapshot: Record<string, string>;
  priceCentsSnapshot: number; quantity: number;
}

export interface AppConfig { purchaseEnabled: boolean; pricingMode: PricingMode }
```

`frontend/src/api.ts` (produced in Task 6, consumed by Tasks 7–10):

```ts
getProducts(): Promise<Product[]>
getAppConfig(): Promise<AppConfig>
getBooking(bookingId: string): Promise<Booking>
getBookingItems(bookingId: string): Promise<BookingItem[]>
addBookingItem(bookingId: string, variantId: string, options: Record<string,string>, quantity?: number): Promise<BookingItem>
removeBookingItem(itemId: string): Promise<void>
deliverBooking(bookingId: string): Promise<{ status: string; error?: string }>
```

---

## Task 1: Supabase init + schema migration

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/0001_schema.sql`
- Test: `supabase/tests/0001_schema_test.sql`

**Interfaces:**
- Produces: the tables and columns in design §4; `app_config` keyed table.

- [ ] **Step 1: Initialize Supabase**

Run: `supabase init` (accept defaults; do not overwrite if a config already exists).
Then start the stack once to confirm Docker works: `supabase start` (leave it running; note the printed `API URL`, `anon key`, `service_role key`).

- [ ] **Step 2: Write the failing pgTAP schema test**

Create `supabase/tests/0001_schema_test.sql`:

```sql
begin;
select plan(8);

select has_table('public','products','products table exists');
select has_table('public','product_variants','product_variants table exists');
select has_table('public','variant_options','variant_options table exists');
select has_table('public','bookings','bookings table exists');
select has_table('public','booking_items','booking_items table exists');
select has_table('public','app_config','app_config table exists');
select col_is_null('public','product_variants','price_cents','price_cents is nullable');
select col_not_null('public','booking_items','price_cents_snapshot','snapshot is not null');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `supabase test db`
Expected: FAIL — tables do not exist yet.

- [ ] **Step 4: Write the schema migration**

Create `supabase/migrations/0001_schema.sql`:

```sql
create table app_config (
  key text primary key,
  value jsonb not null
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  active boolean not null default true
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  size text not null,
  flower_count int not null,
  foliage_level text not null,
  price_cents int,
  active boolean not null default true
);

create table variant_options (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete cascade,
  option_key text not null,
  option_value text not null
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  email text,
  slot_at timestamptz,
  coffee_price_cents int,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_intent_id text,
  redemption_token text not null default encode(gen_random_bytes(6), 'hex'),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  option_snapshot jsonb not null default '{}'::jsonb,
  price_cents_snapshot int not null,
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);
```

- [ ] **Step 5: Reset DB and run the test to verify it passes**

Run: `supabase db reset` (applies migrations), then `supabase test db`
Expected: PASS — all 8 assertions.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/migrations/0001_schema.sql supabase/tests/0001_schema_test.sql
git commit -m "feat: floral schema migration + pgTAP schema test"
```

---

## Task 2: Seed data (config, products, demo user + booking)

**Files:**
- Create: `supabase/seed.sql`
- Test: `supabase/tests/0002_seed_test.sql`

**Interfaces:**
- Consumes: Task 1 schema.
- Produces: `app_config` rows (`floral_purchase_enabled=false`, `pricing_mode="placeholder"`); Table Tree (S/M/L) + Box (MD/LG w/ handle options) with **null prices**; demo user + demo booking (fixed IDs, null stripe fields).

- [ ] **Step 1: Write the failing seed test**

Create `supabase/tests/0002_seed_test.sql`:

```sql
begin;
select plan(6);

select is(
  (select value from app_config where key='floral_purchase_enabled'),
  'false'::jsonb, 'purchase disabled by default');
select is((select count(*) from products), 2::bigint, 'exactly two products');
select is((select count(*) from product_variants), 5::bigint, 'five variants (3 TT + 2 Box)');
select is(
  (select count(*) from product_variants where price_cents is not null),
  0::bigint, 'all prices are placeholder (null)');
select is(
  (select count(*) from variant_options where option_key='handle'),
  4::bigint, 'each Box variant has with/without handle options');
select is(
  (select count(*) from bookings where id='00000000-0000-0000-0000-000000000001'),
  1::bigint, 'demo booking seeded');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db`
Expected: FAIL — no seed rows.

- [ ] **Step 3: Write the seed**

Create `supabase/seed.sql`:

```sql
insert into app_config (key, value) values
  ('floral_purchase_enabled', 'false'::jsonb),
  ('pricing_mode', '"placeholder"'::jsonb);

-- Products
insert into products (id, name, slug, description, active) values
  ('11111111-0000-0000-0000-000000000001', 'Table Tree', 'table-tree',
   'A single statement flower arranged in a coffee cup, with foliage that scales by size.', true),
  ('11111111-0000-0000-0000-000000000002', 'Living Room Box Bouquet', 'box-bouquet',
   'A larger box-format bouquet for living spaces.', true);

-- Table Tree variants (1 flower always; foliage varies). price_cents null (placeholder).
insert into product_variants (id, product_id, size, flower_count, foliage_level, price_cents, active) values
  ('22222222-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'S', 1, 'slight', null, true),
  ('22222222-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-000000000001', 'M', 1, 'some',   null, true),
  ('22222222-0000-0000-0000-0000000000a3', '11111111-0000-0000-0000-000000000001', 'L', 1, 'lots',   null, true);

-- Box Bouquet variants
insert into product_variants (id, product_id, size, flower_count, foliage_level, price_cents, active) values
  ('22222222-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000002', 'MD', 3, 'appropriate',      null, true),
  ('22222222-0000-0000-0000-0000000000b2', '11111111-0000-0000-0000-000000000002', 'LG', 5, 'appropriate_lots', null, true);

-- Handle options for Box variants only
insert into variant_options (variant_id, option_key, option_value) values
  ('22222222-0000-0000-0000-0000000000b1', 'handle', 'with'),
  ('22222222-0000-0000-0000-0000000000b1', 'handle', 'without'),
  ('22222222-0000-0000-0000-0000000000b2', 'handle', 'with'),
  ('22222222-0000-0000-0000-0000000000b2', 'handle', 'without');

-- Demo Supabase Auth user (local dev only). Password: 'demo-password'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'demo@tabletree.test',
        crypt('demo-password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000aa',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"demo@tabletree.test"}'::jsonb,
        'email', now(), now(), now())
on conflict do nothing;

-- Demo booking (steps 1-6 assumed done; stripe fields filled by seed_stripe.ts)
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa',
        'Demo Customer', 'demo@tabletree.test', now() + interval '1 day', 500,
        'demo-redeem-01', 'pending')
on conflict (id) do nothing;
```

- [ ] **Step 4: Reset and run the test to verify it passes**

Run: `supabase db reset` then `supabase test db`
Expected: PASS — all 6 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/tests/0002_seed_test.sql
git commit -m "feat: seed two products, demo user, demo booking (placeholder pricing, flag off)"
```

---

## Task 3: Row-level security

**Files:**
- Create: `supabase/migrations/0002_rls.sql`
- Test: `supabase/tests/0003_rls_test.sql`

**Interfaces:**
- Consumes: Task 1 schema, Task 2 seed.
- Produces: anon-readable catalog; owner-scoped bookings/booking_items.

- [ ] **Step 1: Write the failing RLS test**

Create `supabase/tests/0003_rls_test.sql`:

```sql
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db`
Expected: FAIL — RLS not enabled, so `anon`/other users see everything (assertion 2 returns 1, not 0).

- [ ] **Step 3: Write the RLS migration**

Create `supabase/migrations/0002_rls.sql`:

```sql
-- Table-level privileges (RLS policies are ineffective without these).
grant select on products, product_variants, variant_options, app_config to anon, authenticated;
grant select, update on bookings to authenticated;
grant select, insert, delete on booking_items to authenticated;

alter table products         enable row level security;
alter table product_variants enable row level security;
alter table variant_options  enable row level security;
alter table app_config       enable row level security;
alter table bookings         enable row level security;
alter table booking_items    enable row level security;

-- Public catalog: readable by anon + authenticated, no writes.
create policy "catalog read products" on products
  for select to anon, authenticated using (true);
create policy "catalog read variants" on product_variants
  for select to anon, authenticated using (true);
create policy "catalog read options" on variant_options
  for select to anon, authenticated using (true);
create policy "config read" on app_config
  for select to anon, authenticated using (true);

-- Bookings: owner only.
create policy "own booking read" on bookings
  for select to authenticated using (user_id = auth.uid());
create policy "own booking update" on bookings
  for update to authenticated using (user_id = auth.uid());

-- Booking items: gated by parent booking ownership.
create policy "own items read" on booking_items
  for select to authenticated using (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
create policy "own items insert" on booking_items
  for insert to authenticated with check (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
create policy "own items delete" on booking_items
  for delete to authenticated using (
    exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
```

- [ ] **Step 4: Reset and run to verify it passes**

Run: `supabase db reset` then `supabase test db`
Expected: PASS — all 3 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_rls.sql supabase/tests/0003_rls_test.sql
git commit -m "feat: RLS — public catalog, owner-scoped bookings and items"
```

---

## Task 4: Guard + snapshot trigger

**Files:**
- Create: `supabase/migrations/0003_guard_trigger.sql`
- Test: `supabase/tests/0004_guard_trigger_test.sql`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `booking_items` inserts are gated by `floral_purchase_enabled` + variant priced/active, and `price_cents_snapshot`/`option_snapshot` are stamped server-side.

- [ ] **Step 1: Write the failing trigger test**

Create `supabase/tests/0004_guard_trigger_test.sql`:

```sql
begin;
select plan(5);

-- helper: act as the demo owner
create or replace function _as_owner() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
$$;

-- 1. flag off -> reject
set local role authenticated;
select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000a2', 999)$$,
  'floral_purchase_disabled', 'insert rejected while flag off');

-- enable the flag for the remaining cases
set local role postgres;
update app_config set value='true'::jsonb where key='floral_purchase_enabled';

-- 2. priced-null variant -> reject
set local role authenticated; select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000a2', 999)$$,
  'variant_unpriced', 'insert rejected when variant unpriced');

-- price the Medium Table Tree
set local role postgres;
update product_variants set price_cents=3800
  where id='22222222-0000-0000-0000-0000000000a2';

-- 3. success + snapshot stamped from variant (client 999 ignored)
set local role authenticated; select _as_owner();
insert into booking_items (booking_id, variant_id, price_cents_snapshot)
  values ('00000000-0000-0000-0000-000000000001',
          '22222222-0000-0000-0000-0000000000a2', 999);
select is((select price_cents_snapshot from booking_items limit 1),
          3800, 'snapshot stamped from variant, not client value');

-- 4. Table Tree option forced empty
select is((select option_snapshot from booking_items limit 1),
          '{}'::jsonb, 'table tree option snapshot forced empty');

-- 5. Box handle validated
set local role postgres;
update product_variants set price_cents=6500
  where id='22222222-0000-0000-0000-0000000000b1';
set local role authenticated; select _as_owner();
select throws_ok(
  $$insert into booking_items (booking_id, variant_id, option_snapshot, price_cents_snapshot)
    values ('00000000-0000-0000-0000-000000000001',
            '22222222-0000-0000-0000-0000000000b1', '{"handle":"gold"}'::jsonb, 0)$$,
  'invalid_option', 'invalid handle value rejected');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db`
Expected: FAIL — no trigger; inserts succeed instead of raising.

- [ ] **Step 3: Write the trigger migration**

Create `supabase/migrations/0003_guard_trigger.sql`:

```sql
create or replace function guard_booking_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v record;
  v_handle text;
begin
  select (value)::boolean into v_enabled from app_config where key = 'floral_purchase_enabled';
  if not coalesce(v_enabled, false) then
    raise exception 'floral_purchase_disabled';
  end if;

  select price_cents, active, product_id into v
  from product_variants where id = new.variant_id;
  if v is null or not v.active then
    raise exception 'variant_inactive';
  end if;
  if v.price_cents is null then
    raise exception 'variant_unpriced';
  end if;

  -- Options: only Box variants may carry a handle; validate it.
  if exists (select 1 from variant_options o where o.variant_id = new.variant_id) then
    v_handle := new.option_snapshot->>'handle';
    if v_handle is null or not exists (
      select 1 from variant_options o
      where o.variant_id = new.variant_id and o.option_key='handle' and o.option_value=v_handle
    ) then
      raise exception 'invalid_option';
    end if;
    new.option_snapshot := jsonb_build_object('handle', v_handle);
  else
    new.option_snapshot := '{}'::jsonb;   -- Table Tree: no options
  end if;

  new.price_cents_snapshot := v.price_cents;   -- server-side snapshot
  return new;
end;
$$;

create trigger trg_guard_booking_item
  before insert on booking_items
  for each row execute function guard_booking_item();
```

- [ ] **Step 4: Reset and run to verify it passes**

Run: `supabase db reset` then `supabase test db`
Expected: PASS — all 5 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_guard_trigger.sql supabase/tests/0004_guard_trigger_test.sql
git commit -m "feat: booking_items guard trigger (feature flag gate + server-side snapshot)"
```

---

## Task 5: Frontend scaffold + money formatter

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/.env.example`, `frontend/src/supabase.ts`, `frontend/src/money.ts`
- Test: `frontend/src/money.test.ts`

**Interfaces:**
- Produces: `formatPrice(cents: number | null, mode: PricingMode): string`; a configured `supabase` client.

- [ ] **Step 1: Scaffold the app**

Run:
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install && npm install @supabase/supabase-js react-router-dom && npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```
Add to `frontend/package.json` scripts: `"test": "vitest run"`.
Add to `frontend/vite.config.ts` the Vitest config: `test: { environment: 'jsdom', globals: true, setupFiles: './src/setupTests.ts' }` and create `frontend/src/setupTests.ts` containing `import '@testing-library/jest-dom';`.

- [ ] **Step 2: Create `.env.example` and the Supabase client**

Create `frontend/.env.example`:
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from `supabase start`>
VITE_DEMO_EMAIL=demo@tabletree.test
VITE_DEMO_PASSWORD=demo-password
VITE_DEMO_BOOKING_ID=00000000-0000-0000-0000-000000000001
```
Create `frontend/src/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

- [ ] **Step 3: Write the failing money test**

Create `frontend/src/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatPrice } from './money';

describe('formatPrice', () => {
  it('shows placeholder when unpriced', () => {
    expect(formatPrice(null, 'placeholder')).toBe('$—');
  });
  it('shows placeholder mode even when a price exists', () => {
    expect(formatPrice(3800, 'placeholder')).toBe('$—');
  });
  it('formats cents as dollars in sample mode', () => {
    expect(formatPrice(3800, 'sample')).toBe('$38');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `formatPrice` not defined.

- [ ] **Step 5: Implement `money.ts`**

Create `frontend/src/money.ts`:
```ts
import type { PricingMode } from './types';
export function formatPrice(cents: number | null, mode: PricingMode): string {
  if (mode === 'placeholder' || cents == null) return '$—';
  return '$' + Math.round(cents / 100);
}
```
(Note: `types.ts` is created in Task 6; if running strictly in order, temporarily inline `type PricingMode = 'placeholder' | 'sample'` here and replace with the import in Task 6.)

- [ ] **Step 6: Run to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — 3 assertions.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat: frontend scaffold, supabase client, price formatter"
```

---

## Task 6: Types + API layer

**Files:**
- Create: `frontend/src/types.ts`, `frontend/src/api.ts`
- Test: `frontend/src/api.test.ts`

**Interfaces:**
- Consumes: `supabase` client (Task 5).
- Produces: the `types.ts` and `api.ts` contracts listed in the Interfaces section above.

- [ ] **Step 1: Write the failing API test**

Create `frontend/src/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const invoke = vi.fn();
vi.mock('./supabase', () => ({ supabase: { from: (...a: any[]) => from(...a), functions: { invoke: (...a: any[]) => invoke(...a) } } }));

import { getAppConfig, addBookingItem, deliverBooking } from './api';

beforeEach(() => { from.mockReset(); invoke.mockReset(); });

describe('getAppConfig', () => {
  it('maps app_config rows to purchaseEnabled + pricingMode', async () => {
    from.mockReturnValue({ select: () => Promise.resolve({ data: [
      { key: 'floral_purchase_enabled', value: false },
      { key: 'pricing_mode', value: 'placeholder' },
    ], error: null }) });
    const cfg = await getAppConfig();
    expect(cfg).toEqual({ purchaseEnabled: false, pricingMode: 'placeholder' });
  });
});

describe('addBookingItem', () => {
  it('inserts a booking_items row and returns the mapped item', async () => {
    const insertReturn = { select: () => ({ single: () => Promise.resolve({
      data: { id: 'i1', booking_id: 'b1', variant_id: 'v1', option_snapshot: {}, price_cents_snapshot: 3800, quantity: 1 },
      error: null }) }) };
    from.mockReturnValue({ insert: () => insertReturn });
    const item = await addBookingItem('b1', 'v1', {}, 1);
    expect(item.priceCentsSnapshot).toBe(3800);
    expect(from).toHaveBeenCalledWith('booking_items');
  });
});

describe('deliverBooking', () => {
  it('invokes the edge function and returns status', async () => {
    invoke.mockResolvedValue({ data: { status: 'delivered' }, error: null });
    const res = await deliverBooking('b1');
    expect(res.status).toBe('delivered');
    expect(invoke).toHaveBeenCalledWith('deliver-booking', { body: { booking_id: 'b1' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `api.ts` not found.

- [ ] **Step 3: Write `types.ts`**

Create `frontend/src/types.ts` with the exact contents from the Interfaces section above.

- [ ] **Step 4: Write `api.ts`**

Create `frontend/src/api.ts`:
```ts
import { supabase } from './supabase';
import type { Product, Variant, Booking, BookingItem, AppConfig, PricingMode } from './types';

export async function getAppConfig(): Promise<AppConfig> {
  const { data, error } = await supabase.from('app_config').select();
  if (error) throw error;
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return {
    purchaseEnabled: map.get('floral_purchase_enabled') === true,
    pricingMode: (map.get('pricing_mode') ?? 'placeholder') as PricingMode,
  };
}

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((p: any): Product => ({
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    variants: (p.product_variants ?? []).map((v: any): Variant => ({
      id: v.id, productId: v.product_id, size: v.size,
      flowerCount: v.flower_count, foliageLevel: v.foliage_level, priceCents: v.price_cents,
      options: (v.variant_options ?? []).map((o: any) => ({ key: o.option_key, value: o.option_value })),
    })),
  }));
}

function mapBooking(b: any): Booking {
  return { id: b.id, customerName: b.customer_name, email: b.email, slotAt: b.slot_at,
           coffeePriceCents: b.coffee_price_cents, redemptionToken: b.redemption_token, status: b.status };
}
export async function getBooking(bookingId: string): Promise<Booking> {
  const { data, error } = await supabase.from('bookings').select().eq('id', bookingId).single();
  if (error) throw error;
  return mapBooking(data);
}

function mapItem(r: any): BookingItem {
  return { id: r.id, bookingId: r.booking_id, variantId: r.variant_id,
           optionSnapshot: r.option_snapshot ?? {}, priceCentsSnapshot: r.price_cents_snapshot, quantity: r.quantity };
}
export async function getBookingItems(bookingId: string): Promise<BookingItem[]> {
  const { data, error } = await supabase.from('booking_items').select().eq('booking_id', bookingId);
  if (error) throw error;
  return (data ?? []).map(mapItem);
}

export async function addBookingItem(bookingId: string, variantId: string,
    options: Record<string,string>, quantity = 1): Promise<BookingItem> {
  const { data, error } = await supabase.from('booking_items')
    .insert({ booking_id: bookingId, variant_id: variantId, option_snapshot: options, quantity, price_cents_snapshot: 0 })
    .select().single();
  if (error) throw error;
  return mapItem(data);
}

export async function removeBookingItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('booking_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function deliverBooking(bookingId: string): Promise<{ status: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('deliver-booking', { body: { booking_id: bookingId } });
  if (error) throw error;
  return data as { status: string; error?: string };
}
```
Then update `money.ts` to `import type { PricingMode } from './types'` (remove the inline type from Task 5).

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — api + money suites green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts frontend/src/money.ts
git commit -m "feat: frontend types + supabase-js API layer"
```

---

## Task 7: Floral Collection page (ported design)

**Files:**
- Create: `frontend/src/pages/FloralCollection.tsx`, `frontend/src/components/{ProductCard,SizeSelector,HandleToggle,ContinueBar}.tsx`
- Test: `frontend/src/pages/FloralCollection.test.tsx`
- Delete: root `floral-collection.html` (ported)

**Interfaces:**
- Consumes: `api.ts`, `money.ts`, `types.ts`.
- Produces: default-exported `FloralCollection` route component.

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/pages/FloralCollection.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { getProducts: vi.fn(), getAppConfig: vi.fn(), getBooking: vi.fn(),
              getBookingItems: vi.fn(), addBookingItem: vi.fn(), removeBookingItem: vi.fn() };
vi.mock('../api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import FloralCollection from './FloralCollection';

const products = [{ id: 'p1', name: 'Table Tree', slug: 'table-tree', description: null, variants: [
  { id: 'v-m', productId: 'p1', size: 'M', flowerCount: 1, foliageLevel: 'some', priceCents: null, options: [] },
]}];

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getProducts.mockResolvedValue(products);
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: null, email: null, slotAt: null });
  api.getBookingItems.mockResolvedValue([]);
});

describe('preview-only mode (flag off)', () => {
  it('disables Add and shows placeholder price, never calls addBookingItem', async () => {
    api.getAppConfig.mockResolvedValue({ purchaseEnabled: false, pricingMode: 'placeholder' });
    render(<FloralCollection />);
    const addBtn = await screen.findByRole('button', { name: /coming soon|schedule delivery/i });
    expect(addBtn).toBeDisabled();
    expect(screen.getAllByText('$—').length).toBeGreaterThan(0);
    fireEvent.click(addBtn);
    expect(api.addBookingItem).not.toHaveBeenCalled();
  });
});

describe('purchase enabled', () => {
  it('adds an item and flips the button to Added', async () => {
    api.getAppConfig.mockResolvedValue({ purchaseEnabled: true, pricingMode: 'sample' });
    api.getProducts.mockResolvedValue([{ ...products[0], variants: [{ ...products[0].variants[0], priceCents: 3800 }] }]);
    api.addBookingItem.mockResolvedValue({ id: 'i1', bookingId: 'b1', variantId: 'v-m', optionSnapshot: {}, priceCentsSnapshot: 3800, quantity: 1 });
    render(<FloralCollection />);
    const addBtn = await screen.findByRole('button', { name: /schedule delivery/i });
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('b1', 'v-m', {}, 1));
    await screen.findByRole('button', { name: /added/i });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `FloralCollection` not found.

- [ ] **Step 3: Implement the components and page**

Port the visual design from the existing `floral-collection.html` (same fonts, palette, card layout, striped photo placeholders, sticky bar). Create the four components and the page. `FloralCollection.tsx` responsibilities:
- On mount: `Promise.all([getAppConfig(), getProducts(), getBooking(id), getBookingItems(id)])`; `id` from `import.meta.env.VITE_DEMO_BOOKING_ID`.
- Local UI state per product: selected size; Box handle boolean. Description/photo-label/price derive from the selected variant.
- Add button label: added → "Added ✓"; Table Tree → "Schedule Delivery"; Box → "Add Box Bouquet". When `!purchaseEnabled`: label "Coming soon", `disabled`, helper text "Coming soon — pricing TBD"; no write.
- When enabled: click calls `addBookingItem(bookingId, variantId, box ? {handle: on?'with':'without'} : {}, 1)`; store returned item id; a second click calls `removeBookingItem(itemId)`.
- Sticky `ContinueBar`: skip "No thanks, continue" and "Continue (N added)" both `navigate('/confirmation')`.
- Price shown via `formatPrice(variant.priceCents, pricingMode)`.

Full page code (put shared card markup in `ProductCard`; keep exact styles inline as in the prototype). Minimum viable structure:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAppConfig, getProducts, getBooking, getBookingItems, addBookingItem, removeBookingItem } from '../api';
import type { Product, AppConfig, BookingItem } from '../types';
import { formatPrice } from '../money';
import { ProductCard } from '../components/ProductCard';
import { ContinueBar } from '../components/ContinueBar';

const BOOKING_ID = import.meta.env.VITE_DEMO_BOOKING_ID as string;

export default function FloralCollection() {
  const nav = useNavigate();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<BookingItem[]>([]);

  useEffect(() => {
    Promise.all([getAppConfig(), getProducts(), getBooking(BOOKING_ID), getBookingItems(BOOKING_ID)])
      .then(([c, p, , it]) => { setCfg(c); setProducts(p); setItems(it); });
  }, []);

  async function add(variantId: string, options: Record<string,string>) {
    const item = await addBookingItem(BOOKING_ID, variantId, options, 1);
    setItems(prev => [...prev, item]);
  }
  async function remove(itemId: string) {
    await removeBookingItem(itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  }

  if (!cfg) return null;
  return (
    <div className="screen">
      <div className="grain" />
      <div className="wrap">
        <header className="head">
          <p className="eyebrow">Before your delivery arrives</p>
          <h1>Add something for the table?</h1>
          <p>A little arrangement to go with your coffee — totally optional, skip any time.</p>
        </header>
        <div className="grid">
          {products.map(p => (
            <ProductCard key={p.id} product={p} config={cfg} items={items}
              onAdd={add} onRemove={remove} formatPrice={formatPrice} />
          ))}
        </div>
        <p className="disclaimer">Pricing shown is a placeholder — final pricing TBD.</p>
      </div>
      <ContinueBar count={items.length} onSkip={() => nav('/confirmation')} onContinue={() => nav('/confirmation')} />
    </div>
  );
}
```
`ProductCard` renders the size selector (dot for Table Tree, label+sub for Box), the handle toggle when `product.variants[].options` include `handle`, the description/photo-label derived from the selected variant, and the Add button per the rules above. Move the prototype's CSS into `frontend/src/index.css` (imported in `main.tsx`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — both describe blocks.

- [ ] **Step 5: Delete the superseded prototype**

Run: `git rm floral-collection.html`

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat: FloralCollection page ported to React, preview-only gating"
```

---

## Task 8: deliver-booking Edge Function + Stripe seam

**Files:**
- Create: `supabase/functions/deliver-booking/{index.ts,stripe.ts,deliver.ts,deliver_test.ts}`, `supabase/seed_stripe.ts`

**Interfaces:**
- Consumes: schema + seed. Reads booking + booking_items with service-role.
- Produces: HTTP `POST` handler; `computeCharge` + `runDeliver` pure logic; `StripeGateway` interface.

- [ ] **Step 1: Write the failing deliver logic test**

Create `supabase/functions/deliver-booking/deliver_test.ts`:
```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { computeCharge, runDeliver } from './deliver.ts';
import type { StripeGateway } from './stripe.ts';

Deno.test('computeCharge sums coffee + floral snapshots', () => {
  assertEquals(computeCharge(500, [
    { price_cents_snapshot: 3800, quantity: 1 },
    { price_cents_snapshot: 6500, quantity: 2 },
  ]), 500 + 3800 + 13000);
});

Deno.test('computeCharge treats null coffee price as zero', () => {
  assertEquals(computeCharge(null, [{ price_cents_snapshot: 3800, quantity: 1 }]), 3800);
});

function fakeGateway(behavior: 'ok' | 'decline'): StripeGateway {
  return { async charge() {
    if (behavior === 'decline') { const e: any = new Error('declined'); e.code = 'card_declined'; throw e; }
    return { id: 'pi_test_1' };
  }};
}

Deno.test('runDeliver returns delivered + payment id on success', async () => {
  const r = await runDeliver({ coffee: 500, items: [{ price_cents_snapshot: 3800, quantity: 1 }],
    customer: 'cus', paymentMethod: 'pm' }, fakeGateway('ok'));
  assertEquals(r.status, 'delivered');
  assertEquals(r.paymentIntentId, 'pi_test_1');
});

Deno.test('runDeliver returns payment_failed on card decline', async () => {
  const r = await runDeliver({ coffee: 500, items: [{ price_cents_snapshot: 3800, quantity: 1 }],
    customer: 'cus', paymentMethod: 'pm' }, fakeGateway('decline'));
  assertEquals(r.status, 'payment_failed');
  assertEquals(r.error, 'card_declined');
});

Deno.test('runDeliver skips charge when amount is zero', async () => {
  let called = false;
  const g: StripeGateway = { async charge() { called = true; return { id: 'x' }; } };
  const r = await runDeliver({ coffee: null, items: [], customer: 'cus', paymentMethod: 'pm' }, g);
  assertEquals(r.status, 'delivered');
  assertEquals(called, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd supabase/functions/deliver-booking && deno test --allow-none deliver_test.ts` (or `deno test`)
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the Stripe seam and deliver logic**

Create `supabase/functions/deliver-booking/stripe.ts`:
```ts
export interface ChargeResult { id: string }
export interface StripeGateway {
  charge(args: { amount: number; customer: string; paymentMethod: string }): Promise<ChargeResult>;
}

import Stripe from 'https://esm.sh/stripe@14?target=deno';
export class RealStripe implements StripeGateway {
  private stripe: Stripe;
  constructor(secret: string) { this.stripe = new Stripe(secret, { apiVersion: '2024-06-20' }); }
  async charge({ amount, customer, paymentMethod }: { amount: number; customer: string; paymentMethod: string }) {
    const pi = await this.stripe.paymentIntents.create({
      amount, currency: 'usd', customer, payment_method: paymentMethod,
      off_session: true, confirm: true,
    });
    return { id: pi.id };
  }
}
```
Create `supabase/functions/deliver-booking/deliver.ts`:
```ts
import type { StripeGateway } from './stripe.ts';

export function computeCharge(coffee: number | null, items: { price_cents_snapshot: number; quantity: number }[]): number {
  return (coffee ?? 0) + items.reduce((s, i) => s + i.price_cents_snapshot * i.quantity, 0);
}

export async function runDeliver(
  input: { coffee: number | null; items: { price_cents_snapshot: number; quantity: number }[]; customer: string; paymentMethod: string },
  gateway: StripeGateway,
): Promise<{ status: 'delivered' | 'payment_failed'; paymentIntentId?: string; error?: string }> {
  const amount = computeCharge(input.coffee, input.items);
  if (amount <= 0) return { status: 'delivered' };
  try {
    const res = await gateway.charge({ amount, customer: input.customer, paymentMethod: input.paymentMethod });
    return { status: 'delivered', paymentIntentId: res.id };
  } catch (e: any) {
    return { status: 'payment_failed', error: e.code ?? 'charge_failed' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd supabase/functions/deliver-booking && deno test`
Expected: PASS — 6 tests.

- [ ] **Step 5: Implement the HTTP handler**

Create `supabase/functions/deliver-booking/index.ts`:
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from './stripe.ts';
import { runDeliver } from './deliver.ts';

Deno.serve(async (req) => {
  try {
    const { booking_id } = await req.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: booking, error: bErr } = await admin.from('bookings').select().eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    const { data: items } = await admin.from('booking_items').select('price_cents_snapshot,quantity').eq('booking_id', booking_id);

    const gateway = new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const result = await runDeliver({
      coffee: booking.coffee_price_cents, items: items ?? [],
      customer: booking.stripe_customer_id, paymentMethod: booking.stripe_payment_method_id,
    }, gateway);

    await admin.from('bookings').update({ status: result.status, payment_intent_id: result.paymentIntentId ?? null }).eq('id', booking_id);
    return json(result, result.status === 'delivered' ? 200 : 402);
  } catch (_e) {
    return json({ error: 'bad_request' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 6: Implement the Stripe seed helper**

Create `supabase/seed_stripe.ts` (run manually once after `supabase start`):
```ts
// Usage: STRIPE_SECRET_KEY=sk_test_... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//        deno run --allow-net --allow-env supabase/seed_stripe.ts
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BOOKING_ID = '00000000-0000-0000-0000-000000000001';

const customer = await stripe.customers.create({ email: 'demo@tabletree.test' });
const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
const si = await stripe.setupIntents.create({ customer: customer.id, payment_method: pm.id,
  usage: 'off_session', confirm: true });
console.log('SetupIntent', si.status);
await admin.from('bookings').update({ stripe_customer_id: customer.id, stripe_payment_method_id: pm.id }).eq('id', BOOKING_ID);
console.log('Booking updated with', customer.id, pm.id);
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions supabase/seed_stripe.ts
git commit -m "feat: deliver-booking edge function, Stripe gateway seam, seed helper"
```

---

## Task 9: Confirmation page

**Files:**
- Create: `frontend/src/pages/Confirmation.tsx`
- Test: `frontend/src/pages/Confirmation.test.tsx`

**Interfaces:**
- Consumes: `getBooking`, `getBookingItems`, `getProducts`, `money`.
- Produces: default-exported `Confirmation` route component.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Confirmation.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = { getBooking: vi.fn(), getBookingItems: vi.fn(), getProducts: vi.fn() };
vi.mock('../api', () => api);

import Confirmation from './Confirmation';

beforeEach(() => {
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 'demo-redeem-01', status: 'pending',
    coffeePriceCents: 500, customerName: 'Demo', email: null, slotAt: null });
  api.getBookingItems.mockResolvedValue([]);
  api.getProducts.mockResolvedValue([]);
});

describe('Confirmation', () => {
  it('shows the free-tabletree redemption token', async () => {
    render(<Confirmation />);
    expect(await screen.findByText(/demo-redeem-01/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Confirmation` not found.

- [ ] **Step 3: Implement the page**

Create `frontend/src/pages/Confirmation.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { getBooking, getBookingItems, getProducts } from '../api';
import type { Booking, BookingItem, Variant } from '../types';
import { formatPrice } from '../money';

const BOOKING_ID = import.meta.env.VITE_DEMO_BOOKING_ID as string;

export default function Confirmation() {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [variants, setVariants] = useState<Map<string, { v: Variant; product: string }>>(new Map());

  useEffect(() => {
    Promise.all([getBooking(BOOKING_ID), getBookingItems(BOOKING_ID), getProducts()]).then(([b, it, ps]) => {
      const m = new Map<string, { v: Variant; product: string }>();
      ps.forEach(p => p.variants.forEach(v => m.set(v.id, { v, product: p.name })));
      setBooking(b); setItems(it); setVariants(m);
    });
  }, []);

  if (!booking) return null;
  return (
    <div className="screen"><div className="wrap">
      <h1>You're all set.</h1>
      <section className="redeem">
        <p className="eyebrow">Your free Table Tree</p>
        <p>Show this code in store to redeem your complimentary Table Tree:</p>
        <code className="token">{booking.redemptionToken}</code>
      </section>
      {items.length > 0 && (
        <section>
          <p className="eyebrow">Added to your delivery</p>
          <ul>{items.map(i => {
            const info = variants.get(i.variantId);
            const handle = i.optionSnapshot.handle ? ` · handle: ${i.optionSnapshot.handle}` : '';
            return <li key={i.id}>{info?.product} — {info?.v.size}{handle} — {formatPrice(i.priceCentsSnapshot, 'sample')} × {i.quantity}</li>;
          })}</ul>
        </section>
      )}
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Confirmation.tsx frontend/src/pages/Confirmation.test.tsx
git commit -m "feat: confirmation page with free-tabletree redemption token"
```

---

## Task 10: Staff booking page + router wiring

**Files:**
- Create: `frontend/src/pages/StaffBooking.tsx`, `frontend/src/main.tsx` (router + demo sign-in)
- Test: `frontend/src/pages/StaffBooking.test.tsx`

**Interfaces:**
- Consumes: `getBooking`, `getBookingItems`, `getProducts`, `deliverBooking`.
- Produces: default-exported `StaffBooking`; app router mounting `/`, `/confirmation`, `/staff`.

- [ ] **Step 1: Write the failing staff test**

Create `frontend/src/pages/StaffBooking.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = { getBooking: vi.fn(), getBookingItems: vi.fn(), getProducts: vi.fn(), deliverBooking: vi.fn() };
vi.mock('../api', () => api);

import StaffBooking from './StaffBooking';

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: 'Demo', email: null, slotAt: null });
  api.getProducts.mockResolvedValue([{ id: 'p2', name: 'Living Room Box Bouquet', slug: 'box', description: null,
    variants: [{ id: 'v-md', productId: 'p2', size: 'MD', flowerCount: 3, foliageLevel: 'appropriate', priceCents: 6500, options: [] }] }]);
  api.getBookingItems.mockResolvedValue([{ id: 'i1', bookingId: 'b1', variantId: 'v-md', optionSnapshot: { handle: 'with' }, priceCentsSnapshot: 6500, quantity: 1 }]);
});

describe('StaffBooking', () => {
  it('lists floral line items with size and handle', async () => {
    render(<StaffBooking />);
    expect(await screen.findByText(/Living Room Box Bouquet/)).toBeInTheDocument();
    expect(screen.getByText(/handle: with/i)).toBeInTheDocument();
  });
  it('marks delivered via the edge function', async () => {
    api.deliverBooking.mockResolvedValue({ status: 'delivered' });
    render(<StaffBooking />);
    const btn = await screen.findByRole('button', { name: /mark delivered/i });
    fireEvent.click(btn);
    await waitFor(() => expect(api.deliverBooking).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText(/delivered/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `StaffBooking` not found.

- [ ] **Step 3: Implement the staff page**

Create `frontend/src/pages/StaffBooking.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { getBooking, getBookingItems, getProducts, deliverBooking } from '../api';
import type { Booking, BookingItem, Variant } from '../types';

const BOOKING_ID = import.meta.env.VITE_DEMO_BOOKING_ID as string;

export default function StaffBooking() {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [variants, setVariants] = useState<Map<string, { v: Variant; product: string }>>(new Map());
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    Promise.all([getBooking(BOOKING_ID), getBookingItems(BOOKING_ID), getProducts()]).then(([b, it, ps]) => {
      const m = new Map<string, { v: Variant; product: string }>();
      ps.forEach(p => p.variants.forEach(v => m.set(v.id, { v, product: p.name })));
      setBooking(b); setItems(it); setVariants(m); setStatus(b.status);
    });
  }, []);

  async function markDelivered() {
    const res = await deliverBooking(BOOKING_ID);
    setStatus(res.status);
  }

  if (!booking) return null;
  return (
    <div className="screen"><div className="wrap">
      <h1>Booking {booking.id.slice(0, 8)}</h1>
      <p>Status: <strong>{status}</strong></p>
      <h2>Floral items to prepare</h2>
      <ul>{items.map(i => {
        const info = variants.get(i.variantId);
        const handle = i.optionSnapshot.handle ? ` · handle: ${i.optionSnapshot.handle}` : '';
        return <li key={i.id}>{info?.product} — size {info?.v.size}{handle} × {i.quantity}</li>;
      })}</ul>
      <button onClick={markDelivered} disabled={status === 'delivered'}>Mark delivered</button>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — both assertions.

- [ ] **Step 5: Wire the router + demo sign-in**

Replace `frontend/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { supabase } from './supabase';
import FloralCollection from './pages/FloralCollection';
import Confirmation from './pages/Confirmation';
import StaffBooking from './pages/StaffBooking';
import './index.css';

// Demo convenience: sign in the seeded user so RLS-scoped reads/writes work.
await supabase.auth.signInWithPassword({
  email: import.meta.env.VITE_DEMO_EMAIL, password: import.meta.env.VITE_DEMO_PASSWORD,
});

const router = createBrowserRouter([
  { path: '/', element: <FloralCollection /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBooking /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
```

- [ ] **Step 6: Run the full suite + manual smoke**

Run: `cd frontend && npm test` (all green), then `npm run dev` and confirm `/`, `/confirmation`, `/staff` render against local Supabase.
Expected: all tests PASS; pages load.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat: staff booking page + router wiring + demo sign-in"
```

---

## Task 11: README / run docs

**Files:**
- Create: `README.md` (repo root) or update if present.

**Interfaces:** none.

- [ ] **Step 1: Document setup**

Add a README section covering: `supabase start`; copy anon key into `frontend/.env`; run `supabase db reset` (applies migrations + seed); run `supabase/seed_stripe.ts` with a test `STRIPE_SECRET_KEY` to attach a payment method; `supabase functions serve deliver-booking` with `STRIPE_SECRET_KEY` + `SUPABASE_SERVICE_ROLE_KEY`; `cd frontend && npm run dev`. Note the feature flag: `update app_config set value='true' where key='floral_purchase_enabled';` plus setting `price_cents` to enable purchase.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: local setup + how to enable floral purchase"
```

---

## Self-Review

**Spec coverage:**
- §1 placement / skippable → ContinueBar skip+continue → Confirmation (Task 7, 9). ✓
- §2 two products, Minimalist shelved → seed has exactly 2 (Task 2). ✓
- §2 Table Tree S/M/L, Box MD/LG + handle → seed + ProductCard (Tasks 2, 7). ✓
- §3 free tabletree fixed/independent → `redemption_token`, Confirmation (Tasks 1, 9). ✓
- §4 data model incl. snapshots → schema + trigger (Tasks 1, 4). ✓
- §5 gating trigger, preview-only default → Task 4 + Task 7 UI. ✓
- §6 RLS → Task 3. ✓
- §7 frontend pages → Tasks 7, 9, 10. ✓
- §8 Stripe off_session at delivery + seed helper + test seam → Task 8. ✓
- §9 tests (trigger, RLS, deliver, frontend) → Tasks 3, 4, 6, 7, 8, 9, 10. ✓
- §11 env/deps → Task 11 README. ✓

**Placeholder scan:** No TBD/TODO left as work items; the only "placeholder" references are the intended product state (unpriced variants), which is enforced by design.

**Type consistency:** `formatPrice(cents, mode)`, `addBookingItem(bookingId, variantId, options, quantity)`, `deliverBooking(bookingId)`, `computeCharge(coffee, items)`, `runDeliver(input, gateway)`, `StripeGateway.charge({amount,customer,paymentMethod})` — names/signatures consistent across Tasks 5–10. Demo IDs consistent (`...0001` booking, `...00aa` user). ✓
