# Floral Cup Collection — Full-Stack Integration Design

**Date:** 2026-07-10
**Status:** Approved design (pending spec review)
**Depends on:** `table-tree-spec-sheet.md` (product spec), the pasted build spec (flow integration)
**Stack decision:** Supabase-native (Postgres + RLS + Edge Functions) + Vite/React/TS frontend + Stripe (test mode)

---

## 1. Goal & scope

Insert an **optional floral add-on step** into the existing coffee-delivery booking flow, immediately before the confirmation page. The customer can add Table Tree and/or Living Room Box Bouquet arrangements to their booking; these are charged **with the coffee, in a single off-session PaymentIntent, when staff mark the booking delivered**.

**In scope (what we build):**
- Postgres schema for products/variants/options and booking line items (Supabase).
- Direct-from-browser reads and add/remove of floral items via `supabase-js`, guarded by RLS + a database trigger.
- A `deliver-booking` Supabase Edge Function that performs the off-session Stripe charge.
- Three React pages: Floral Collection (the add-on page), Confirmation (with redemption token), Staff Booking detail.
- Seed data: two products, a demo Supabase Auth user, a demo booking with a saved Stripe test payment method.

**Out of scope (represented by seed data, not built):**
- Booking-flow steps 1–6 (QR landing → beverage → address → slot → account → card-save). The seeded booking already has a Supabase Auth user, a slot, a Stripe customer, and a saved payment method — i.e. steps 1–6 are assumed done.
- A discount/credit engine (see §3).
- Per-item fulfilment status (booking-level status only).

**Key product constraints (from `table-tree-spec-sheet.md`):**
- Two products only. **Table Tree Minimalist is shelved — do not render or seed it.**
- Table Tree: sizes S/M/L; always exactly 1 flower + coffee-cup vessel + foliage; only foliage volume varies.
- Living Room Box Bouquet: sizes Medium (3 flowers) / Large (5 flowers); optional handle (with/without); flower count fixed per size.
- Pricing is placeholder (`$—`) until confirmed.
- Mobile-first (users arrive via QR scan on phones).

---

## 2. Free-tabletree resolution (build-spec §3)

**Decision: option (a) — fixed and independent.** The QR promo grants a free in-store tabletree (a fixed SKU, e.g. Small Table Tree) that is unaffected by this page. It is represented by `bookings.redemption_token`, displayed on the Confirmation page. Purchased Table Trees are separate `booking_items`. **No discount engine, no upgrade/replace logic.**

---

## 3. Architecture

Supabase-native. The browser talks to Supabase directly for everything except the Stripe charge, which is the one privileged, secret-bearing action and therefore lives in an Edge Function.

```
supabase/
  migrations/
    0001_schema.sql        products, product_variants, variant_options, bookings, booking_items, app_config
    0002_rls.sql           row-level security policies
    0003_guard_trigger.sql BEFORE INSERT trigger on booking_items (gate + snapshot)
  functions/
    deliver-booking/
      index.ts             Deno + Stripe: off_session PaymentIntent; updates booking status
      stripe.ts            RealStripe (test mode) | FakeStripe (tests) behind one interface
  seed.sql                 2 products + variants + options + app_config row + demo booking
  seed_stripe.ts           creates test Stripe customer, attaches pm_card_visa via SetupIntent(usage=off_session)
frontend/
  src/
    supabase.ts            supabase-js client (anon key)
    api.ts                 typed read/write helpers over supabase-js + Edge Function calls
    pages/
      FloralCollection.tsx add-on page (ported from floral-collection.html design, pixel-faithful)
      Confirmation.tsx     booking summary, floral items, redemption token
      StaffBooking.tsx     booking detail + floral line items + "Mark delivered"
    components/            ProductCard, SizeSelector, HandleToggle, ContinueBar
  index.html, vite.config.ts, package.json, tsconfig.json
docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md   (this file)
```

**Untouched:** the existing root `index.html` (Karminal thank-you page) is a different context and stays as-is. The static `floral-collection.html` prototype is ported into `FloralCollection.tsx` (visual design preserved) and then removed.

### Data flow
1. **Load page:** React reads `products` (+ variants, options), the current `booking`, its `booking_items`, and `app_config.floral_purchase_enabled` via `supabase-js`.
2. **Add item:** React inserts a `booking_items` row (`variant_id`, `options`, `quantity`). The `BEFORE INSERT` trigger validates the gate, stamps the price/option snapshot, and either commits or raises.
3. **Remove item:** React deletes the `booking_items` row (RLS restricts to the owner).
4. **Continue / No thanks:** navigate to Confirmation. "No thanks" adds nothing.
5. **Deliver (staff):** StaffBooking calls the `deliver-booking` Edge Function → it sums coffee + floral snapshots, creates an off-session PaymentIntent, updates `bookings.status`.

---

## 4. Data model (Supabase Postgres, follows build-spec §4)

```sql
-- app_config: single-row key/value knobs
app_config(key text primary key, value jsonb not null)
  -- seeded: ('floral_purchase_enabled', 'false'), ('pricing_mode', '"placeholder"')

products(
  id uuid pk default gen_random_uuid(),
  name text not null, slug text unique not null,
  description text, active boolean not null default true)

product_variants(
  id uuid pk default gen_random_uuid(),
  product_id uuid not null references products(id),
  size text not null,                 -- 'S'|'M'|'L' (Table Tree), 'MD'|'LG' (Box)
  flower_count int not null,
  foliage_level text not null,        -- 'slight'|'some'|'lots'|'appropriate'|'appropriate_lots'
  price_cents int,                    -- NULLABLE until pricing confirmed
  active boolean not null default true)

variant_options(                      -- Box Bouquet variants only
  id uuid pk default gen_random_uuid(),
  variant_id uuid not null references product_variants(id),
  option_key text not null,           -- 'handle'
  option_value text not null)         -- 'with' | 'without'

bookings(
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_name text, email text,
  slot_at timestamptz,
  coffee_price_cents int,             -- nullable; part of delivery total
  stripe_customer_id text,
  stripe_payment_method_id text,
  redemption_token text not null default encode(gen_random_bytes(6),'hex'),
  status text not null default 'pending',  -- 'pending'|'delivered'|'payment_failed'
  created_at timestamptz not null default now())

booking_items(
  id uuid pk default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  option_snapshot jsonb not null default '{}',   -- e.g. {"handle":"with"}
  price_cents_snapshot int not null,             -- stamped by trigger from variant
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz not null default now())
```

**Snapshotting rationale (build-spec §4):** `price_cents_snapshot` and `option_snapshot` freeze the state at add-time so later price/option edits never mutate historical bookings. Both are set **server-side by the trigger**, not trusted from the client.

---

## 5. Server-side gating & snapshot trigger

A `BEFORE INSERT` trigger on `booking_items` (`0003_guard_trigger.sql`) enforces the feature flag and produces the snapshot, so direct browser writes cannot bypass either:

1. Read `floral_purchase_enabled` from `app_config`. If false → `RAISE EXCEPTION 'floral_purchase_disabled'`.
2. Load the referenced `product_variants` row. If `active = false` → raise. If `price_cents IS NULL` → `RAISE EXCEPTION 'variant_unpriced'` (placeholder pricing blocks purchase, per build-spec §5/§8.6).
3. For a Box variant, validate `NEW.option_snapshot->>'handle' IN ('with','without')` against `variant_options`; for Table Tree, force `option_snapshot = '{}'`.
4. Set `NEW.price_cents_snapshot = variant.price_cents`.

**Result:** with the seed's default (flag off, prices null), every add is rejected and the page is preview-only. Setting prices **and** flipping `floral_purchase_enabled` to true enables real add-to-booking — no code change.

---

## 6. Row-level security (`0002_rls.sql`)

- `products`, `product_variants`, `variant_options`, `app_config`: `SELECT` allowed to `anon` + `authenticated` (public catalog). No client writes.
- `bookings`: `SELECT`/`UPDATE` where `user_id = auth.uid()`.
- `booking_items`: `SELECT`/`INSERT`/`DELETE` where the parent `booking.user_id = auth.uid()`. INSERT still passes through the guard trigger.
- The `deliver-booking` Edge Function uses the **service-role key** (bypasses RLS) because it acts on staff's behalf across bookings.

---

## 7. Frontend (Vite + React + TS)

Three routed pages; `supabase-js` for reads/writes; the Floral Collection page ports the existing prototype's visual design faithfully (Fraunces/Work Sans/JetBrains Mono, cream/gold palette, card layout, striped photo placeholders).

- **FloralCollection.tsx** — reads products + booking + items + `purchase_enabled`. Renders two `ProductCard`s. Size selectors and the Box handle toggle drive live description/photo-label/price updates (client state). Add button:
  - When `purchase_enabled` is false (default): buttons **disabled**, `$—` shown, helper text "Coming soon — pricing TBD." No writes attempted.
  - When enabled: Add inserts a `booking_items` row; a successful insert flips the button to "Added ✓"; toggling off deletes the row. The sticky bar shows `Continue (N added)`.
  - "No thanks, continue" and "Continue" both navigate to Confirmation.
- **Confirmation.tsx** — booking summary, list of floral line items (product, size, handle, snapshot price), and the **redemption token** for the free in-store tabletree.
- **StaffBooking.tsx** — booking detail with floral line items (product, size, handle option) for arrangement prep, plus a **"Mark delivered"** button that invokes `deliver-booking` and reflects the resulting status (delivered / payment_failed).

**Pricing display:** `pricing_mode = placeholder` → `$—` everywhere. When real prices exist, formatted from `price_cents`.

---

## 8. Payments — `deliver-booking` Edge Function (Stripe test mode, real calls)

- **Setup (simulates build-spec step 6):** `seed_stripe.ts` creates a Stripe **test** customer, attaches `pm_card_visa` via a SetupIntent with `usage: 'off_session'`, and writes `stripe_customer_id` + `stripe_payment_method_id` onto the demo booking.
- **Charge at delivery:** `deliver-booking` receives `{ booking_id }` (staff-authenticated), loads the booking + its `booking_items` with the service-role key, computes `amount = COALESCE(coffee_price_cents, 0) + Σ(price_cents_snapshot × quantity)`, and creates a PaymentIntent with `customer`, `payment_method`, `off_session: true`, `confirm: true`.
  - Success → `bookings.status = 'delivered'`, store `payment_intent_id`.
  - `card_declined` / `authentication_required` (StripeCardError) → `status = 'payment_failed'`, return a structured error the staff UI surfaces.
  - If `amount = 0` (no priced items and no coffee price) → mark delivered without a charge.
- **Test seam:** the function depends on a `Stripe`-shaped interface; the real path uses the test-mode Stripe SDK, tests inject `FakeStripe` (records intents, simulates decline) so no network is required.
- **Secrets:** `STRIPE_SECRET_KEY` (test) and `SUPABASE_SERVICE_ROLE_KEY` live in the Edge Function environment. Documented in the plan; the user supplies the Stripe test key.

---

## 9. Testing (TDD)

- **Guard trigger (pgTAP or SQL-through-a-test-harness):**
  - insert rejected with `floral_purchase_disabled` when flag off;
  - insert rejected with `variant_unpriced` when `price_cents` null (flag on);
  - insert succeeds when flag on + priced; `price_cents_snapshot` equals the variant price; client-supplied price is ignored;
  - Box handle option validated; Table Tree option forced to `{}`.
- **RLS:** a user cannot read/insert/delete another user's `booking_items`.
- **`deliver-booking` (Deno test):** sums coffee + floral snapshots; calls Stripe with `off_session:true`; success → `delivered`; injected decline → `payment_failed`; zero amount → delivered without charge.
- **Frontend (Vitest + RTL, light):** preview-only rendering when `purchase_enabled` false (buttons disabled, `$—`, no write); Add/remove flips button + counter when enabled.

---

## 10. Build order

1. **Schema + RLS + guard trigger + seed** (migrations, `app_config`, two products/variants/options, demo user + booking). Trigger tests first (TDD).
2. **Direct-write add/remove** path verified against the trigger (reads + inserts + deletes via `supabase-js`).
3. **FloralCollection.tsx** wired to Supabase; port the existing design; preview-only behavior under the default flag.
4. **`deliver-booking` Edge Function** + Stripe charging + `seed_stripe.ts` + **StaffBooking.tsx**.
5. **Confirmation.tsx** with the redemption token.

---

## 11. Dependencies & environment

- **Supabase CLI + Docker** for local dev (`supabase start` → local Postgres, Edge runtime, Studio). Migrations are portable to a linked cloud project later.
- **Node** for the Vite/React frontend.
- **Env:** frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (from `supabase start`); Edge Function `STRIPE_SECRET_KEY` (user-supplied test key) + `SUPABASE_SERVICE_ROLE_KEY`.

---

## 12. Open items (from build-spec §8, tracked, not launch blockers for this build)

1. **Pricing per size/product** — real blocker for *enabling purchase*; until set, the flag stays off and the page is preview-only (by design here).
2. Photography — size-comparison (Table Tree), handle vs no-handle (Box); placeholders used until assets exist.
3. Customer-facing naming confirmation ("Table Tree", "Living Room Box Bouquet").
4. Coffee-delivery pricing (`coffee_price_cents`) — assumed known per booking; seed sets a value.
