# Broader Booking System — Real Card-Save + Staff Role — Design

_Date: 2026-07-11_

## Purpose

Make two slices of the booking system **production-shaped** instead of demo-seeded,
closing the two "broader booking system" open items from the floral-collection handoff:

- **A. Real card-save** — a customer saves a real card in the browser (Stripe Elements),
  which populates `bookings.stripe_customer_id` / `stripe_payment_method_id` server-side.
  Replaces the hardcoded `seed_stripe.ts` card attachment.
- **B. Staff role** — `deliver-booking` (and booking reads) authorize a real **staff** role
  instead of being owner-scoped. Staff can view all bookings and deliver (charge) any of them.

These are two independent workstreams shipped under one spec. **Build B first** (self-contained,
fully SQL/curl-testable), then A.

## Scope

**In scope**
- Role model: `user_roles` + `has_role()` (DONE — migration `0006_roles.sql`, applied).
- Test fixtures: staff/admin/customer users + a few cross-owner bookings (DONE — `seed_test.sql`, applied).
- Staff-read RLS on `bookings` + `booking_items`.
- `deliver-booking` authorizes owner **or** staff.
- `/staff` becomes a pending-bookings list → existing detail + Mark-delivered view.
- Card-save: `create-setup-intent` + `save-card` edge functions, a `/card` browser page with
  Stripe Elements, and the `StripeGateway` extension (`createCustomer`, `createSetupIntent`,
  `retrieveSetupIntent`).

**Out of scope**
- Booking creation (steps 1–5: QR landing → beverage → address → slot → account). This repo owns
  the floral add-on + confirmation + staff + (now) card-save. Bookings still originate as seed data.
- Admin capabilities. The `admin` role exists in the enum + a test user, but no feature reads it yet.
- Stripe webhooks. Card persistence is synchronous (see Workstream A).
- Real staff auth UX (invite/SSO). Staff sign in with the seeded test credentials.

## Decisions (settled during brainstorming)

| Fork | Decision |
|---|---|
| Card-save depth | **Full browser Stripe Elements flow** |
| Staff role model | **`user_roles` table + `has_role()`** (Supabase-recommended RBAC) |
| Card persistence | **Synchronous confirm edge fn** (no webhook) |
| Staff UI | **Pending-bookings list + detail** |

## Current state (already applied to the hosted project `ifyvsrmdnmqlqifcqpnx`)

Migration `0006_roles.sql` and `seed_test.sql` are applied and verified:

- `app_role` enum (`'staff'`, `'admin'`), `user_roles(user_id, role)` table.
- `has_role(_user_id uuid, _role app_role)` — `security definer`, `stable`, `search_path=''`,
  granted to `authenticated`. Verified returns correct answers.
- Users (all sign in, HTTP 200): `staff@` (staff), `admin@` (admin), `alice@`/`bob@`/`carol@`
  (customers), plus the existing `demo@`.
- Bookings: Demo (pending, card), Alice (pending, no card, Table Tree M), Bob (pending, no card,
  Box MD +handle), Carol (delivered, card). The two no-card bookings exercise card-save; the
  delivered one exercises the staff pending-list filter.

---

## Workstream B — Staff role

### B1. Staff-read RLS (`0007_staff_booking_rls.sql`)

Add SELECT policies **alongside** the existing owner-read policies (purely additive — staff gain
read access; nobody loses anything):

```sql
create policy "staff read all bookings" on bookings
  for select to authenticated using (has_role(auth.uid(), 'staff'));

create policy "staff read all items" on booking_items
  for select to authenticated using (has_role(auth.uid(), 'staff'));
```

No staff INSERT/UPDATE/DELETE on bookings: the client never writes booking state (that stays
server-owned via the service-role edge function), consistent with `0005`.

### B2. `deliver-booking` authorization

Replace the owner-only guard:

```
if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);
```

with **owner OR staff**. The edge function uses the service-role client, so it queries the role
directly (RLS-exempt):

```
const isOwner = booking.user_id === user.id;
const { data: staffRow } = await admin
  .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'staff').maybeSingle();
const isStaff = !!staffRow;
if (!isOwner && !isStaff) return json({ error: 'forbidden' }, 403);
```

Update the stale "staff is out of scope" comment. All other behaviour (idempotency on `delivered`,
sum + off-session charge, 401/404/500) is unchanged.

### B3. Staff frontend — pending list + detail

- **Routes:** `/staff` (list) and `/staff/:bookingId` (detail). The detail view is today's
  `StaffBooking.tsx`, parameterized by route param instead of `VITE_DEMO_BOOKING_ID`.
- **List (`StaffBookings.tsx`):** `api.listPendingBookings()` → `select ... from bookings where
  status <> 'delivered' order by slot_at`. RLS returns all rows because the caller is staff.
  Renders id (short), customer, status, coffee + floral totals, item count; row links to detail.
- **Auth:** staff must be signed in as a staff user. The current `main.tsx` auto-signs-in the demo
  **customer**, who is not staff — so `/staff` needs staff auth. Minimal approach: a tiny sign-in
  affordance on `/staff` (email+password → `supabase.auth.signInWithPassword`) shown when the
  current session lacks the staff role; on success it re-queries. This keeps the customer
  auto-signin for `/` and `/card` untouched. (A dedicated staff auth context is out of scope.)
- **New API:** `listPendingBookings()`, and `getBooking`/`getBookingItems`/`deliverBooking`
  already exist (detail reuses them).

### B4. Testing (Workstream B)

- **SQL/RLS:** a pgTAP-style test (repo `supabase/tests/`) asserting: staff sees all bookings,
  a non-staff customer sees only their own, `has_role` truth table. Run via `execute_sql` against
  the hosted project (no local Docker).
- **Edge fn (deno):** unit tests for the authz branch — owner allowed, staff-non-owner allowed,
  non-staff-non-owner → 403 — using a stubbed role lookup.
- **E2E (curl):** staff JWT delivers Alice's booking (staff ≠ owner) → 200; a non-staff customer
  JWT against another customer's booking → 403.
- **Frontend (vitest):** the list renders seeded pending bookings; a delivered booking is absent;
  clicking a row routes to detail.

---

## Workstream A — Real card-save

### A1. `StripeGateway` extension

The repo already abstracts Stripe behind `StripeGateway` (currently `charge`) with a `RealStripe`
implementation and a fake for tests. Extend the interface:

```ts
interface StripeGateway {
  charge(args): Promise<{ id: string }>;                       // existing
  createCustomer(args: { email?: string }): Promise<{ id: string }>;
  createSetupIntent(args: { customer: string }):
    Promise<{ id: string; clientSecret: string }>;
  retrieveSetupIntent(id: string):
    Promise<{ id: string; status: string; customer: string; paymentMethod: string }>;
}
```

`RealStripe` implements these against the Stripe API (SetupIntent with
`usage: 'off_session'`, `payment_method_types: ['card']`). A `FakeStripe` returns canned values
for unit tests.

### A2. `create-setup-intent` edge function (verify_jwt=true)

1. Authenticate caller from JWT (reject anon-key-only → 401).
2. Load booking (service role); require ownership (`booking.user_id === user.id`) else 403/404.
3. Reuse `booking.stripe_customer_id` if present, else `createCustomer({ email: booking.email })`.
   Persist the customer id onto the booking immediately (so retries reuse it; a customer with no
   attached PM is harmless).
4. `createSetupIntent({ customer })` → return `{ clientSecret }` (200).

### A3. `save-card` edge function (verify_jwt=true) — synchronous confirm

1. Authenticate + load booking + require ownership.
2. `retrieveSetupIntent(setup_intent_id)` **from Stripe** (never trust client-supplied
   customer/PM ids).
3. Verify `status === 'succeeded'` **and** `retrieved.customer === booking.stripe_customer_id`
   (binds the SetupIntent to this booking's customer — blocks attaching a foreign PM). Else 400/409.
4. Write `stripe_payment_method_id = retrieved.paymentMethod` (and re-affirm `stripe_customer_id`)
   onto the booking with the service-role key. Return `{ saved: true }` (200).

Why synchronous (not webhook): no webhook infra to register/verify, and it's fully curl-testable.
A dropped browser just means no card saved — `deliver-booking` already treats a missing PM as
`payment_failed`, and the customer can re-run `/card`.

### A4. `/card` browser page

- **Deps:** add `@stripe/stripe-js` + `@stripe/react-stripe-js`. New env
  `VITE_STRIPE_PUBLISHABLE_KEY` (Stripe sandbox `pk_test_…`).
- **Flow:** on mount call `create-setup-intent` → `{ clientSecret }`. Render `<Elements>` +
  `<PaymentElement>`. On submit → `stripe.confirmSetup({ elements, clientSecret,
  redirect: 'if_required' })`; on success call `save-card({ booking_id, setup_intent_id })`,
  then navigate to `/` (floral collection). Surface Stripe errors inline.
- **Which booking:** the signed-in customer's booking (Alice/Bob have no card and are ideal test
  targets). For the demo customer flow, point `/card` at the customer's own booking id.

### A5. Seed change

Remove `seed_stripe.ts`'s role as the source of the demo card; the `/card` flow is now the real
path. The demo booking may keep its seeded card (back-compat), but Alice/Bob deliberately start
cardless so the flow is exercised end-to-end.

### A6. Testing (Workstream A)

- **Edge fn (deno):** `create-setup-intent` (reuse-vs-create customer, ownership 403, anon 401) and
  `save-card` (succeeded path stamps PM; non-succeeded → error; customer-mismatch → error) with
  `FakeStripe`.
- **Frontend (vitest):** `/card` renders, calls `create-setup-intent` on mount, and calls
  `save-card` + navigates on a mocked successful `confirmSetup` (mock `@stripe/react-stripe-js`).
- **E2E (browser):** drive the preview browser with Stripe test card `4242 4242 4242 4242`,
  confirm, then read the booking via MCP to assert `stripe_payment_method_id` is now set; then a
  staff `deliver-booking` charges it successfully (real Stripe test-mode PaymentIntent, refunded).

---

## Security notes

- Card-writing columns (`stripe_*`) are written **only** by service-role edge functions;
  client booking-UPDATE remains revoked (`0005`). `save-card` re-derives customer/PM from the
  retrieved SetupIntent, never from the request body.
- Staff-read RLS is additive; no client write path to bookings is opened.
- `has_role()` is `SECURITY DEFINER` with empty `search_path`; `guard_booking_item` stays
  non-RPC-callable (`0004`). New functions follow the same hardening.

## Environment constraints (carried from handoff)

- **Stripe MCP** can only create customers + refunds — it cannot create SetupIntents. The browser
  Elements path is verified via the **deployed** edge function (real `STRIPE_SECRET_KEY`) + the
  preview browser, not via MCP.
- **No local Supabase/Docker** — migrations applied to the hosted project via MCP; SQL tests run
  via `execute_sql`.
- `deploy_edge_function` on redeploy needs explicit `import_map_path: "deno.json"`.

## Build order

1. **B1** staff-read RLS (`0007`) → **B2** deliver-booking authz → **B4** tests → verify (curl).
2. **B3** staff list + detail routes → vitest → browser check.
3. **A1** gateway extension → **A2** create-setup-intent → **A3** save-card → **A6** edge tests → curl.
4. **A4** `/card` page + deps + env → vitest → browser E2E with test card.
5. Docs + PR; confirm Netlify deploy green.
