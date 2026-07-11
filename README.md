# Tabletree — Onboarding Funnel + Floral Add-ons

A six-step onboarding funnel now fronts the coffee-delivery booking flow: store landing,
beverage preference, address validation, slot hold, account creation, and card save. Once
the booking is finalized to `pending`, customers can optionally add a Table Tree and/or
Living Room Box Bouquet before the confirmation page. Floral items attach to the booking
and are charged with the coffee in a single off-session Stripe PaymentIntent when staff
mark the booking delivered.

- Design spec: [`docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md`](docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-10-floral-cup-collection.md`](docs/superpowers/plans/2026-07-10-floral-cup-collection.md)
- Funnel spec: [`docs/superpowers/specs/2026-07-11-onboarding-funnel-design.md`](docs/superpowers/specs/2026-07-11-onboarding-funnel-design.md)
- Funnel plan: [`docs/superpowers/plans/2026-07-11-onboarding-funnel.md`](docs/superpowers/plans/2026-07-11-onboarding-funnel.md)

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
  seed.sql      2 products, 5 variants (placeholder pricing) — shared catalog only
  seed_dev.sql  demo user + booking (dev/branch-only; never seeds the prod branch)
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
                StaffBookings / StaffBooking + onboarding funnel screens
```

Hosted project: **`ifyvsrmdnmqlqifcqpnx`** (region `ap-northeast-1`).

## Run the frontend

```bash
cd frontend
cp .env.example .env      # then fill in the values below
npm install
npm run dev               # http://localhost:5173
npm test
```

`.env` values (from the Supabase project's API settings):

```
VITE_SUPABASE_URL=https://ifyvsrmdnmqlqifcqpnx.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...       # Stripe sandbox publishable key; required for /card
```

Routes:
- `/` — onboarding funnel
- `/bonus-flowers` — floral add-ons
- `/confirmation` — redemption token
- `/staff` — pending-bookings list (all non-delivered bookings, staff-only via RLS); prompts for
  staff sign-in if the current session lacks the `staff` role
- `/staff/:bookingId` — booking detail: line items + Mark delivered (owner or staff can deliver)

## Onboarding funnel

The root flow creates and progressively fills a `draft` booking through `SECURITY DEFINER`
RPCs from migration `0008_funnel.sql`:

1. Anonymous auth is established in the browser.
2. A draft booking is started and enriched with store, beverage, address, and slot hold data.
3. The anonymous user is upgraded in place with account credentials and the customer name is
   stamped onto the draft.
4. The existing `create-setup-intent`, `save-card`, and `CardSave` Stripe flow is reused to
   save a payment method.
5. `finalize_draft_booking()` flips the booking from `draft` to `pending`, after which the user
   lands on `/bonus-flowers`.

Anonymous sign-ins must be enabled in Supabase Auth, and `VITE_STRIPE_PUBLISHABLE_KEY` is
required for the card step.

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

The funnel's `/card` step reuses the existing browser card-save flow:

1. On mount, the page calls `create-setup-intent` (verify_jwt=true), which authenticates the
   caller, loads their booking, reuses `stripe_customer_id` if already set or creates a Stripe
   customer and stamps it onto the booking, then returns a SetupIntent `clientSecret`.
2. The page renders Stripe Elements' `<PaymentElement>` and calls `stripe.confirmSetup(...)`.
3. On success it calls `save-card` (verify_jwt=true) with the `setup_intent_id`, which
   **re-retrieves the SetupIntent from Stripe** (never trusts the client-supplied ids), verifies
   `status === 'succeeded'` and that the SetupIntent's customer matches the booking's stamped
   customer, then writes `stripe_payment_method_id` (and re-affirms `stripe_customer_id`) onto
   the booking with the service-role key.
4. The page finalizes the draft booking and routes to `/bonus-flowers`.

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

## Environments (dev/prod)

Two isolated environments, **one Supabase project each**. `main` is production;
the `dev` git branch is development. A dev mistake can never touch prod data or
take a live payment because dev talks to a completely separate database and a
Stripe sandbox.

| Layer | prod (`main`) | dev (`dev` branch) |
|---|---|---|
| Supabase project | `tabletree` (`ifyvsrmdnmqlqifcqpnx`) | `tabletree-dev` (`ogxjrvhrwoltkcncprcf`) |
| VITE_SUPABASE_URL | `https://ifyvsrmdnmqlqifcqpnx.supabase.co` | `https://ogxjrvhrwoltkcncprcf.supabase.co` |
| VITE_SUPABASE_ANON_KEY | prod publishable key | `sb_publishable_nrYaSY3dYN6VaROsFCPuxg_ohiX2h6-` |
| STRIPE_SECRET_KEY (Supabase fn secret) | sk_live_… | sk_test_… |
| VITE_STRIPE_PUBLISHABLE_KEY (Netlify env) | pk_live_… | pk_test_… |
| ALLOWED_ORIGINS (Supabase fn secret) | prod site origin | dev site origin + http://localhost:5173 |
| Netlify | production context (← main) | branch-deploy context (← dev) |

Both projects share the same migrations (`supabase/migrations/`), kept in sync
with `supabase db push`. The dev project is additionally seeded with demo data
(`seed.sql` + `seed_dev.sql`); prod gets catalog only, never the demo rows.

### Keeping the two projects in sync

Migrations are the source of truth — apply them to whichever project you target:

```bash
supabase link --project-ref ogxjrvhrwoltkcncprcf && supabase db push   # dev
supabase link --project-ref ifyvsrmdnmqlqifcqpnx && supabase db push   # prod
```

### One-time setup

1. **Dev project schema + seed** — already provisioned (all migrations + both
   seeds applied to `tabletree-dev`). For a fresh rebuild: `supabase db push`
   against the dev ref, then run `seed.sql` and `seed_dev.sql` against it.
2. **Edge functions (per project)** — deploy to each; the CLI bundles the shared
   `_shared/` code automatically:
   ```bash
   supabase functions deploy --project-ref ogxjrvhrwoltkcncprcf   # dev
   supabase functions deploy --project-ref ifyvsrmdnmqlqifcqpnx   # prod
   ```
3. **Supabase function secrets (per project)** — set `STRIPE_SECRET_KEY`
   (sk_test_ on dev, sk_live_ on prod) and `ALLOWED_ORIGINS` (comma-separated
   site origins):
   ```bash
   supabase secrets set --project-ref ogxjrvhrwoltkcncprcf \
     STRIPE_SECRET_KEY=sk_test_… ALLOWED_ORIGINS=https://dev--<site>.netlify.app,http://localhost:5173
   supabase secrets set --project-ref ifyvsrmdnmqlqifcqpnx \
     STRIPE_SECRET_KEY=sk_live_… ALLOWED_ORIGINS=https://<prod-site>
   ```

   **IMPORTANT — ALLOWED_ORIGINS on prod is a required gate:** if `ALLOWED_ORIGINS` is unset on the prod project, the edge-function CORS resolver silently fails open. It echoes back whatever `Origin` the request carries instead of enforcing the allowlist, disabling the CORS lockdown entirely, so it MUST be set on prod.

   **Verification:** after deploying prod, confirm the lockdown works with a preflight from a disallowed origin:
   ```bash
   curl -si -X OPTIONS -H "Origin: https://not-allowed.example" -H "Access-Control-Request-Method: POST" https://ifyvsrmdnmqlqifcqpnx.supabase.co/functions/v1/save-card | grep -i access-control-allow-origin
   ```
   A correctly-configured prod **must NOT** echo `Access-Control-Allow-Origin: https://not-allowed.example`. If it does, `ALLOWED_ORIGINS` is unset and the lockdown is open.
4. **Netlify (one site, two contexts):** production context (main) → prod Supabase
   URL/anon + `pk_live_` key; `dev` branch-deploy context → dev project URL/anon +
   `pk_test_` key.
5. **Supabase Auth URLs (per project):** Authentication → URL Configuration. Set
   the Site URL + Redirect URLs to that environment's host (dev site URL for dev,
   prod site URL for prod) so email/magic-link redirects land correctly.

### dev → prod promotion

Merge `dev` → `main` (git). Netlify redeploys the production context. Apply any
new migrations to prod with `supabase db push` against the prod ref, and redeploy
functions if they changed. Demo data is never introduced to prod because
`seed_dev.sql` is only ever run against the dev project.

**Caution:** never run `supabase db reset`, `seed.sql`, or `seed_dev.sql` against
the prod ref (`ifyvsrmdnmqlqifcqpnx`). `seed_dev.sql` contains the demo user +
booking and would reintroduce test data into production.

## Notes

- Free in-store Table Tree = `bookings.redemption_token`, shown on the Confirmation page.
  It is fixed and independent of anything purchased here (no discount logic).
- The root `index.html` (Karminal thank-you page) is a separate, pre-existing page.
