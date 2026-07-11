# Onboarding Funnel — Design Spec

**Date:** 2026-07-11
**Status:** Approved (brainstorming complete)

## Goal

Add a six-step onboarding funnel as the new front door of the app. It captures store
attribution, a beverage preference, a delivery address (with a serviceability check),
a held delivery slot, an account, and a saved card — producing a booking that then flows
into the existing floral add-on page. The current landing page (`FloralCollection`) moves
from `/` to `/bonus-flowers`.

The six steps:

1. Store-attributed landing
2. Favourite beverage question
3. Address entry → delivery range check
4. Slot selection (10-minute hold)
5. Account creation (name, email, password; address attached)
6. Card save (Stripe SetupIntent, `usage: 'off_session'`)

## Context

The existing app (see `2026-07-10-floral-cup-collection-design.md`) is Supabase-native:
Vite + React 19 + react-router-dom 7 + supabase-js on the frontend; RLS + a guard trigger
on Postgres; a `deliver-booking` Deno edge function (with a mockable Stripe seam) for the
off-session charge. Today it assumes a pre-existing demo user and demo booking (from
`VITE_DEMO_*` env vars); nothing creates them through the UI.

**Critical constraint discovered during brainstorming:** migration `0005` deliberately
revoked `UPDATE` on `bookings` from `authenticated` and there is no client `INSERT` grant.
Bookings are **server-owned** for charge integrity — only the service-role edge function
writes `status`, pricing, and `stripe_*` columns. The funnel must write booking data from
the browser without breaking this. Resolution: **every funnel mutation goes through a
`SECURITY DEFINER` RPC** that touches only whitelisted columns on the caller's own draft
booking. The browser never gets direct write access to `bookings`.

## Global Constraints

- Frontend: Vite + React 19 + react-router-dom 7 + `@supabase/supabase-js`. No new state
  library — funnel state via a React context over the draft booking row.
- TDD throughout. Tests: pgTAP (`supabase/tests`, run via `supabase test db`), Deno
  (`deno test`, network-free), Vitest (`frontend`, `../api` and Stripe mocked).
- Preserve the charge-integrity model: clients must never be able to write `status`,
  `coffee_price_cents`, `price_cents_snapshot`, or `stripe_*` columns.
- Stripe on the frontend uses `@stripe/stripe-js` + `@stripe/react-stripe-js`; edge
  functions reuse the existing `STRIPE_SECRET_KEY` secret and the existing mockable Stripe
  seam (mock by default so dev/tests need no live key).
- Delivery serviceability = **postcode allowlist** (no geocoding, no external API).
- Slots are **computed from a schedule** in `app_config` — no slots table.
- The 10-minute hold is enforced server-side against the draft booking (`hold_expires_at`),
  made possible by **anonymous auth** giving a real `user_id` from the landing.

## Architecture

**Auth & booking lifecycle.**

1. On landing, if there is no session, call `supabase.auth.signInAnonymously()`. This yields
   a real `user_id` immediately.
2. `start_draft_booking(store_code)` creates (or returns the existing) `status='draft'`
   booking owned by `auth.uid()` and stamps the store code. Idempotent per user.
3. Steps 2–4 write to that draft via RPCs.
4. Step 5 upgrades the anonymous user in place with
   `supabase.auth.updateUser({ email, password })` — the draft booking is already owned by
   that user id, so no re-linking is needed — then `set_booking_customer(name)` stamps name
   and email onto the booking.
5. Step 6 saves a card via SetupIntent; `finalize-setup` (service role) writes the
   `stripe_*` columns and flips `status` `draft → pending`.
6. Funnel routes into `/bonus-flowers`.

**Mutation model — SECURITY DEFINER RPCs.** Each RPC asserts the caller has a `draft`
booking they own and updates only whitelisted columns:

| RPC | Signature | Behaviour |
|-----|-----------|-----------|
| `start_draft_booking` | `(store_code text) returns uuid` | Insert-or-return the caller's draft booking; stamp `store_code`. Returns booking id. |
| `set_booking_beverage` | `(beverage text) returns void` | Set `beverage` on caller's draft. |
| `check_postcode` | `(postcode text) returns boolean` | True if `postcode` ∈ `app_config.delivery_postcodes`. |
| `set_booking_address` | `(line1 text, line2 text, suburb text, postcode text) returns boolean` | Re-check postcode; if in range, write address fields on caller's draft and return true; else return false and write nothing. |
| `available_slots` | `() returns table(slot_at timestamptz, remaining int)` | Compute upcoming slots from `app_config.slot_schedule`; remaining = capacity − (bookings on that slot with status in (`pending`,`delivered`) OR draft holds with `hold_expires_at > now()`). |
| `hold_slot` | `(slot_at timestamptz) returns boolean` | Atomically re-check remaining > 0 for that slot; if so set `slot_at` + `hold_expires_at = now() + interval '10 minutes'` on caller's draft, return true; else false. |
| `set_booking_customer` | `(name text) returns void` | Set `customer_name` = name and `email` = the caller's auth email on caller's draft. |

All RPCs are `SECURITY DEFINER`, `set search_path = public`, and `raise exception` if the
caller has no owned draft booking (except `check_postcode`/`available_slots`, which are
read-only and need no draft). Grant `execute` to `authenticated` (anonymous users are
`authenticated` in Supabase).

**Schema additions (migration `0006`).**

```sql
alter table bookings
  add column store_code       text,
  add column beverage         text,
  add column address_line1    text,
  add column address_line2    text,
  add column suburb           text,
  add column postcode         text,
  add column hold_expires_at  timestamptz;
```

- `status` gains a `'draft'` value (status is free-text today; add a CHECK constraint
  covering `draft`,`pending`,`delivered`,`payment_failed` for defense in depth).
- New `app_config` rows (seed): `delivery_postcodes` (JSON array of strings),
  `beverage_options` (JSON array of strings), `slot_schedule`
  (`{ "weekdays":[1,2,3,4,5], "startHour":9, "endHour":17, "slotMinutes":60, "capacity":3, "horizonDays":7 }`).
- Demo user + demo booking seed remain (for `/staff` and existing tests); the funnel does
  not depend on `VITE_DEMO_BOOKING_ID`.

## Frontend

**Routing.**

```
/                → funnel landing (step 1); captures ?store=CODE
/beverage        → step 2
/address         → step 3
/slot            → step 4
/account         → step 5
/card            → step 6 → navigate('/bonus-flowers')
/bonus-flowers   → FloralCollection (moved from /); loads caller's own draft booking
/confirmation    → Confirmation (loads caller's own booking)
/staff           → StaffBooking (unchanged; still uses demo booking id)
```

**Funnel state & guards.** A `FunnelProvider` (React context) holds the current booking id
and derived completion flags, hydrated on mount from the caller's own draft booking (owner-read
RLS already allows selecting it). The draft row is the source of truth; context is a cache.
Each step guards its prerequisite and redirects backward if unmet:

- `/beverage`: requires a draft booking (created at landing).
- `/address`: requires draft booking.
- `/slot`: requires an in-range address on the draft.
- `/account`: requires a live (unexpired) slot hold.
- `/card`: requires a non-anonymous account.

Forward deep-linking past an unmet prerequisite redirects to the earliest incomplete step.
A mid-funnel refresh resumes at the correct step from the hydrated draft.

**Step behaviours.**

1. **Landing** — read `?store=CODE`; `signInAnonymously()` if no session; `start_draft_booking(code)`; store booking id in context. Single CTA → `/beverage`.
2. **Beverage** — render `beverage_options`; selection → `set_booking_beverage`; advance. Non-blocking (can proceed without changing a default).
3. **Address** — form (line1, line2, suburb, postcode); submit → `set_booking_address`. On `false`, show inline "not in our delivery area yet" and block advance. On `true` → `/slot`.
4. **Slot** — `available_slots()` → list of times with remaining capacity; pick → `hold_slot(slot_at)`. Show a countdown derived from `hold_expires_at`. On expiry, clear selection and prompt re-pick. `hold_slot` returning `false` (slot filled) → show "just taken, pick another" and refresh the list. On success → `/account`.
5. **Account** — name/email/password; `updateUser({ email, password })` then `set_booking_customer(name)`. Handle "email already registered" inline. On success → `/card`.
6. **Card** — Stripe Elements. `create-setup-intent` → `client_secret`; `stripe.confirmCardSetup(client_secret, { payment_method: { card } })` with the customer configured `off_session`; on success `finalize-setup(booking_id, setup_intent_id)`; then `navigate('/bonus-flowers')`. Card errors shown inline; the card is not charged (setup only).

**Existing pages.** `FloralCollection` and `Confirmation` stop reading `VITE_DEMO_BOOKING_ID`
and instead fetch the caller's own current booking (a new `getMyBooking()` in `api.ts` using
the owner-read policy). `StaffBooking` is unchanged.

## Edge functions

Two new Deno functions under `supabase/functions`, reusing `deliver-booking`'s Stripe seam
pattern (`stripe.ts` mock double + `stripe_real.ts`), mock by default:

- **`create-setup-intent`** — input `{ booking_id }`. Creates or reuses a Stripe customer for
  the booking, creates a SetupIntent (`usage: 'off_session'`), returns
  `{ client_secret, customer_id }`. Does not yet write booking columns.
- **`finalize-setup`** — input `{ booking_id, setup_intent_id }`. Service role: retrieves the
  SetupIntent, asserts `status === 'succeeded'`, reads its `payment_method`, writes
  `stripe_customer_id` + `stripe_payment_method_id` on the booking and sets `status='pending'`.
  Returns `{ status }`. Rejects (no write) if the SetupIntent is not succeeded.

## Data flow

```
Landing ──signInAnonymously──▶ start_draft_booking(code) ──▶ draft booking (user-owned)
Beverage ─set_booking_beverage─▶ draft.beverage
Address ──set_booking_address──▶ draft.address_* (guarded by check_postcode)
Slot ─available_slots→ hold_slot ─▶ draft.slot_at + hold_expires_at (atomic capacity check)
Account ─updateUser(email,pw)→ set_booking_customer ─▶ anon user upgraded; draft.customer_name/email
Card ─create-setup-intent→ confirmCardSetup→ finalize-setup ─▶ draft.stripe_* ; status=pending
        └──────────────────────────────────▶ navigate('/bonus-flowers')
```

## Error handling

- **No draft / expired session:** funnel steps redirect to landing, which re-establishes an
  anonymous session and a fresh draft.
- **Out-of-range postcode:** inline message, advance blocked; no address written.
- **Hold expiry / slot filled:** clear selection, refresh slots, prompt re-pick. `hold_slot`
  is the atomic gate — capacity is never oversold even under a race.
- **Email already registered:** inline message on the account step; user can use a different
  email (a full "sign in to existing account" flow is out of scope).
- **SetupIntent not succeeded:** `finalize-setup` writes nothing and returns an error status;
  the card step shows an inline error and stays put.
- **Stripe misconfigured (no live key):** functions run against the mock seam and succeed in
  dev/test; live behaviour is gated exactly like the existing purchase flag.

## Testing strategy

- **pgTAP** (`supabase/tests`): `start_draft_booking` idempotency; whitelisted RPCs cannot
  write `status`/`stripe_*`/price columns; `check_postcode` allow + deny; `set_booking_address`
  writes only when in range; `available_slots` capacity math; `hold_slot` sets hold and is
  rejected when the slot is full; hold expiry frees capacity.
- **Deno** (`deno test`, network-free via the Stripe seam): `create-setup-intent` returns a
  client secret; `finalize-setup` writes stripe fields + `pending` on success and rejects a
  non-succeeded SetupIntent.
- **Vitest** (`frontend`, `../api` + Stripe mocked): each step renders and advances; guards
  redirect on unmet prerequisites; postcode-fail blocks advance; hold countdown + expiry;
  account upgrade success + "email already registered"; card step calls
  `create-setup-intent` then `finalize-setup` in order; `/bonus-flowers` and `/confirmation`
  load the caller's own booking.

## Out of scope (YAGNI)

- Geocoding, radius, or drawn delivery zones (postcode allowlist only).
- A stores table / validated store codes (free-form opaque code only).
- Reusable saved addresses / a separate addresses table (address lives on the booking).
- Sign-in to a pre-existing account, password reset, email verification gating.
- Per-store delivery schedules (single global `slot_schedule`).
- Changing the beverage answer's effect on pricing or offers (captured, non-blocking).
