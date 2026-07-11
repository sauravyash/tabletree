# Tabletree — Floral Cup Collection

An optional **floral add-on step** in the coffee-delivery booking flow: customers add a
Table Tree and/or Living Room Box Bouquet to their booking just before the confirmation
page. Floral items attach to the booking and are charged with the coffee in a single
off-session Stripe PaymentIntent when staff mark the booking delivered.

- Design spec: [`docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md`](docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-10-floral-cup-collection.md`](docs/superpowers/plans/2026-07-10-floral-cup-collection.md)

## Architecture

Supabase-native. The browser reads the catalog and adds/removes floral line items directly
via `supabase-js`; a `BEFORE INSERT` trigger enforces the feature flag and stamps
price/option snapshots server-side. A `deliver-booking` Edge Function (Deno + Stripe,
service-role) performs the charge.

```
supabase/
  migrations/   0001 schema · 0002 RLS + grants · 0003 guard trigger · 0004 harden trigger
                0005 drop client bookings-UPDATE + money CHECKs
                0006 roles (user_roles + has_role) · 0007 staff-read RLS
  seed.sql      2 products, 5 variants (placeholder pricing), demo user + booking
  seed_test.sql staff/admin/alice/bob/carol test users + bookings #2-#4
  tests/        pgTAP tests (schema, seed, RLS, guard trigger) for `supabase test db`
  functions/
    _shared/            shared Stripe gateway seam (charge, createCustomer,
                         createSetupIntent, retrieveSetupIntent) + RealStripe/FakeStripe
    deliver-booking/    Deno edge fn: computeCharge/runDeliver, authorizes booking owner OR staff
    create-setup-intent/  Deno edge fn: resolves/creates the booking's Stripe customer, returns
                           a SetupIntent client secret
    save-card/            Deno edge fn: confirms the SetupIntent server-side, stamps
                           stripe_customer_id/stripe_payment_method_id onto the booking
frontend/       Vite + React + TS; supabase-js; FloralCollection / Confirmation / CardSave /
                StaffBookings / StaffBooking
```

Hosted project: **`ifyvsrmdnmqlqifcqpnx`** (region `ap-northeast-1`).

## Run the frontend

```bash
cd frontend
cp .env.example .env      # then fill in the values below
npm install
npm run dev               # http://localhost:5173
npm test                  # 11/11 vitest
```

`.env` values (from the Supabase project's API settings):

```
VITE_SUPABASE_URL=https://ifyvsrmdnmqlqifcqpnx.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
VITE_DEMO_EMAIL=demo@tabletree.test
VITE_DEMO_PASSWORD=demo-password
VITE_DEMO_BOOKING_ID=00000000-0000-0000-0000-000000000001
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...       # Stripe sandbox publishable key; required for /card
```

Routes:
- `/` — floral add-ons
- `/confirmation` — redemption token
- `/card` — save a real card via Stripe Elements (`create-setup-intent` → `<PaymentElement>` →
  `save-card`) for the signed-in customer's booking
- `/staff` — pending-bookings list (all non-delivered bookings, staff-only via RLS); prompts for
  staff sign-in if the current session lacks the `staff` role
- `/staff/:bookingId` — booking detail: line items + Mark delivered (owner or staff can deliver)

### Seeded test credentials

`seed_test.sql` provisions these users (all `@tabletree.test`, applied to the hosted project):

| Role | Email | Password |
|---|---|---|
| Staff | `staff@tabletree.test` | `staff-password` |
| Admin | `admin@tabletree.test` | `admin-password` |
| Customer | `alice@tabletree.test` | `test-password` |
| Customer | `bob@tabletree.test` | `test-password` |
| Customer | `carol@tabletree.test` | `test-password` |

Alice and Bob's seeded bookings start without a saved card (good targets for `/card`); Carol's
is already `delivered` (exercises the staff pending-list filter, which excludes it).

## Database & function tooling

Migrations live in `supabase/migrations` and have been applied to the hosted project. To work
against it with the CLI: `supabase link --project-ref ifyvsrmdnmqlqifcqpnx`, then
`supabase db push`. With Docker you can run the pgTAP tests locally via `supabase test db`.

Edge functions: `supabase/functions/deliver-booking`, `create-setup-intent`, `save-card`, all
sharing the `_shared/` Stripe gateway seam (`RealStripe` in prod, `FakeStripe` for unit tests).
Unit tests: `deno test` in each function directory (network-free).

## Card-save flow

`/card` replaces the old hardcoded `seed_stripe.ts` card attachment with a real browser flow:

1. On mount, the page calls `create-setup-intent` (verify_jwt=true), which authenticates the
   caller, loads their booking, reuses `stripe_customer_id` if already set or creates a Stripe
   customer and stamps it onto the booking, then returns a SetupIntent `clientSecret`.
2. The page renders Stripe Elements' `<PaymentElement>` and calls `stripe.confirmSetup(...)`.
3. On success it calls `save-card` (verify_jwt=true) with the `setup_intent_id`, which
   **re-retrieves the SetupIntent from Stripe** (never trusts the client-supplied ids), verifies
   `status === 'succeeded'` and that the SetupIntent's customer matches the booking's stamped
   customer, then writes `stripe_payment_method_id` (and re-affirms `stripe_customer_id`) onto
   the booking with the service-role key.
4. The page navigates back to `/`.

`deliver-booking` treats a booking with no saved payment method as `payment_failed`, so a
dropped `/card` flow is safe — the customer can just re-run it.

## Staff role

Migration `0006_roles.sql` adds an `app_role` enum (`staff`, `admin`), a `user_roles` table, and
a `security definer` `has_role()` function. Migration `0007_staff_booking_rls.sql` adds
additive staff-read SELECT policies on `bookings`/`booking_items` (owner-read policies are
unchanged). `deliver-booking` now authorizes the caller if they're the booking's owner **or**
hold the `staff` role (looked up server-side via the service-role client, RLS-exempt).

## Enabling purchase (currently preview-only)

By design the page is **preview-only** until pricing is set. Two server-side conditions gate it:

1. Set real prices: `update product_variants set price_cents = <cents> where id = ...;`
2. Flip the flag: `update app_config set value='true'::jsonb where key='floral_purchase_enabled';`

The guard trigger rejects any add while the flag is off **or** the variant is unpriced, so no
code change is needed to go live.

## Live charging

`deliver-booking` is deployed but needs a Stripe **test** secret to actually charge:

1. Set the function secret `STRIPE_SECRET_KEY` (Supabase dashboard → Edge Functions → Secrets,
   or `supabase secrets set STRIPE_SECRET_KEY=sk_test_...`).
2. Attach a saved payment method to the booking. The real path is the browser `/card` flow
   above (needs `VITE_STRIPE_PUBLISHABLE_KEY`); manually you can also create a test customer +
   attach `pm_card_visa` via a SetupIntent (`usage: 'off_session'`), then
   `update bookings set stripe_customer_id=..., stripe_payment_method_id=... where id=...`.

Without the secret, `deliver-booking` returns `{status:"payment_failed", error:"charge_failed"}`.

## Notes

- Free in-store Table Tree = `bookings.redemption_token`, shown on the Confirmation page.
  It is fixed and independent of anything purchased here (no discount logic).
- The root `index.html` (Karminal thank-you page) is a separate, pre-existing page.
