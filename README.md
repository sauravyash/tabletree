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
  seed.sql      2 products, 5 variants (placeholder pricing), demo user + booking
  tests/        pgTAP tests (schema, seed, RLS, guard trigger) for `supabase test db`
  functions/deliver-booking/   Deno edge fn: computeCharge/runDeliver + Stripe seam
frontend/       Vite + React + TS; supabase-js; FloralCollection / Confirmation / StaffBooking
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
```

Routes: `/` (add-ons), `/confirmation` (redemption token), `/staff` (line items + Mark delivered).

## Database & function tooling

Migrations live in `supabase/migrations` and have been applied to the hosted project. To work
against it with the CLI: `supabase link --project-ref ifyvsrmdnmqlqifcqpnx`, then
`supabase db push`. With Docker you can run the pgTAP tests locally via `supabase test db`.

Edge function: `supabase/functions/deliver-booking`. Unit tests: `deno test` (5/5, network-free).

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
2. Attach a saved payment method to the demo booking (simulating the card-save step): create a
   test customer + attach `pm_card_visa` via a SetupIntent (`usage: 'off_session'`), then
   `update bookings set stripe_customer_id=..., stripe_payment_method_id=... where id=...`.

Without the secret, `deliver-booking` returns `{status:"payment_failed", error:"charge_failed"}`.

## Notes

- Free in-store Table Tree = `bookings.redemption_token`, shown on the Confirmation page.
  It is fixed and independent of anything purchased here (no discount logic).
- The root `index.html` (Karminal thank-you page) is a separate, pre-existing page.
