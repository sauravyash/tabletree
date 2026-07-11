# Floral Cup Collection — Handoff / Continue-From-Here

_Last updated: 2026-07-11_

## What this is
An optional **floral add-on step** in the coffee-delivery booking flow: on a page just
before the confirmation/thank-you page, a customer can add a **Table Tree** (S/M/L) and/or
**Living Room Box Bouquet** (MD/LG, optional handle) to their booking. Floral items attach
to the booking and are charged **with the coffee in one off-session Stripe PaymentIntent**
when staff mark the booking delivered.

Built via brainstorm → spec → plan → subagent-driven TDD, then hardened after a whole-branch review.

**In-repo docs (read these for detail):**
- Spec: `docs/superpowers/specs/2026-07-10-floral-cup-collection-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-floral-cup-collection.md`
- Setup/run: `README.md`
- Task ledger: `.superpowers/sdd/progress.md`

## Status: feature COMPLETE and verified live
All 11 plan tasks done. Frontend 14/14 vitest, clean build. Backend applied + verified live
(schema/RLS/trigger/seed assertions, 401 unauth, idempotency, real off-session charges of
$5 coffee-only and $70 with a box item — both refunded, booking reset).

## Live resources & IDs
| Thing | Value |
|---|---|
| GitHub repo | `sauravyash/tabletree`, branch `floral-collection-integration`, base `main` |
| Supabase project | `tabletree`, ref **`ifyvsrmdnmqlqifcqpnx`**, org `qaawnpeirsitcspshsfv`, region `ap-northeast-1` |
| Supabase URL | `https://ifyvsrmdnmqlqifcqpnx.supabase.co` |
| Publishable anon key | `sb_publishable_FXVsKctcVMYQYzTczzxcug_8brkCsGi` (public) |
| Edge function | `deliver-booking` deployed **v2**, `verify_jwt=true`. `STRIPE_SECRET_KEY` secret is SET (user did it) |
| Stripe | sandbox `acct_1Trb7BFptIezgh2L` (test mode) |
| Stripe demo customer | `cus_UrOZt1HFqS4LaG` + `pm_card_visa`, wired onto the demo booking |
| Demo auth user | `demo@tabletree.test` / `demo-password`, id `00000000-0000-0000-0000-0000000000aa` |
| Demo booking | id `00000000-0000-0000-0000-000000000001`, coffee 500¢, token `demo-redeem-01`, status `pending` |
| Netlify | project `koslistau`, site_id `98a7bdee-5be3-4672-915a-dee6181e8a65`, prod `https://koslist.au` |

## Current LIVE DB state (differs from repo defaults!)
On the hosted project I **enabled purchasing** for demoing:
- `app_config.floral_purchase_enabled = true`, `pricing_mode = 'sample'`
- Prices set: Table Tree S/M/L = **2800 / 3800 / 5200**¢, Box MD/LG = **6500 / 9500**¢
- `seed.sql` in the repo STILL defaults to preview-only (null prices, flag false) — the safe
  default. A fresh `db reset`/new project returns to preview-only. These live prices are NOT
  in git (they'd need to be baked into a seed/migration to be reproducible).

## Architecture (Supabase-native)
- Browser reads catalog + adds/removes booking items directly via `supabase-js`.
- `BEFORE INSERT` trigger `guard_booking_item()` gates on flag + variant priced/active and
  **stamps `price_cents_snapshot`/`option_snapshot` server-side** (client can't spoof price).
- RLS: catalog readable by anon/authenticated; bookings/booking_items scoped to owner, plus
  additive staff-read policies (`0007`) so staff can see all bookings.
- `deliver-booking` edge function (Deno, service-role) authenticates caller + requires booking
  ownership **or** the `staff` role, is idempotent (won't re-charge `delivered`), sums coffee +
  snapshots, off-session charges via Stripe, updates status. Returns 200 for delivered/payment_failed;
  401/403/404/500 for errors.
- `create-setup-intent` + `save-card` edge functions (Deno, service-role, `_shared/` Stripe
  gateway seam) let a signed-in customer save a real card via Stripe Elements; `save-card`
  re-retrieves the SetupIntent from Stripe server-side before stamping
  `stripe_customer_id`/`stripe_payment_method_id` onto the booking.
- Frontend: Vite + React + TS in `frontend/`. Routes `/` (FloralCollection), `/confirmation`,
  `/card` (CardSave, Stripe Elements), `/staff` (StaffBookings pending list, staff-sign-in gated),
  `/staff/:bookingId` (StaffBooking detail). `main.tsx` auto signs-in the demo customer for `/`
  and `/card`; `/staff` prompts for staff credentials separately. Env in `frontend/.env`
  (gitignored), incl. new `VITE_STRIPE_PUBLISHABLE_KEY`.
- Migrations: `0001` schema, `0002` RLS+grants, `0003` guard trigger, `0004` revoke-execute
  hardening, `0005` drop client bookings-UPDATE + money CHECKs, `0006` role model
  (`user_roles` + `has_role()`), `0007` staff-read RLS on bookings/booking_items.
- `seed_test.sql`: seeded staff/admin/customer test users (`staff@`, `admin@`,
  `alice@`/`bob@`/`carol@tabletree.test`) + cross-owner bookings for exercising the staff and
  card-save flows. See `README.md` for the full credentials table.

## PRs
`#1`–`#7` all MERGED (`#7`: real page title + meta description). A new PR from branch
`broader-booking-system` (real card-save + staff role) is opened against `main` — see the
"Broader booking system" section below for status.

## ✅ Deploy verified live (2026-07-11)
- PR #6 deploy is **green** and merged; secret scanner passes.
- Production `https://koslist.au` returns 200 and mounts. `VITE_SUPABASE_URL` + anon key are
  **baked into the prod bundle** (`assets/index-*.js`) → the Netlify env vars are set and the
  deployed app reaches Supabase.
- Anon catalog read against live Supabase works (both `products` active; `floral_purchase_enabled
  = true`, `pricing_mode = sample`) — i.e. the live page's on-load fetch succeeds under RLS.

## Broader booking system — real card-save + staff role

Spec: `docs/superpowers/specs/2026-07-11-broader-booking-system-design.md`. Plan:
`docs/superpowers/plans/2026-07-11-broader-booking-system.md`. Ledger:
`.superpowers/sdd/progress.md`.

**Status: code + backend verification COMPLETE; one browser E2E step pending an owner-provided key.**

- ✅ Staff role (Workstream B): `0006`/`0007` migrations applied + verified; `deliver-booking`
  owner-or-staff authz verified live via curl (staff JWT delivers a non-owned booking → 200;
  non-staff JWT against another customer's booking → 403); `/staff` pending-list + `/staff/:id`
  detail + staff sign-in gate shipped and unit-tested.
- ✅ Real card-save (Workstream A): `_shared/` Stripe gateway seam extended
  (`createCustomer`/`createSetupIntent`/`retrieveSetupIntent`); `create-setup-intent` deployed
  and verified live (real 200 + Stripe customer stamped onto a booking); `save-card` unit-tested
  (4/4 deno) with error-path curls (401/500/403) verified; `/card` Stripe Elements page shipped,
  frontend 22/22 vitest, clean build.
- ⏳ **Pending**: the live browser happy-path E2E (enter test card `4242 4242 4242 4242` on
  `/card`, confirm the booking is stamped, then have staff deliver it) is **blocked on an
  owner-provided `VITE_STRIPE_PUBLISHABLE_KEY`** (Stripe sandbox `pk_test_...`). All other
  verification for this feature is done at the API/unit level.

## Still needed (owner actions, not code)
1. ~~Merge PR #6~~ — DONE. ~~Netlify env vars~~ — DONE (verified baked into prod bundle).
2. **Business inputs** (spec open items): real prices, customer-facing product names, photography.
3. **Set `VITE_STRIPE_PUBLISHABLE_KEY`** (Stripe sandbox `pk_test_...`) in Netlify's build
   environment variables, and locally in `frontend/.env`, so `/card` works in production. Until
   this is set, `/card` cannot mount Stripe Elements and the live browser card-save E2E above
   stays pending.

## Optional / nice-to-have
- Bake real prices into a `seed`/migration so the enabled state is reproducible.
- Accessibility: Lighthouse ~85 (decorative photo divs, muted-label contrast).
- Enable Supabase leaked-password protection (advisor WARN; dashboard toggle).
- Demo password is inherently public in this client-side-auth demo — not a prod pattern.

## Environment / tooling gotchas (this machine)
- **No Docker** → no local Supabase; everything runs against the hosted project via the Supabase MCP.
- **Deno** installed at `~/.deno/bin/deno` (used to run edge-fn unit tests: `deno test` in the function dir).
- **Supabase MCP** has no secrets tool (can't set `STRIPE_SECRET_KEY` — user does it in dashboard).
  `deploy_edge_function` on **re**deploy needs explicit `import_map_path: "deno.json"` or it errors
  on a stale import-map path.
- **Stripe MCP** is a curated subset: writes limited to `PostCustomers` + `create_refund`; rich
  reads via `fetch_stripe_resources`. No payment-method-attach/SetupIntent (test `pm_card_visa`
  charges off-session without an explicit attach, which is how the live charge test worked).
- **Netlify MCP** is intermittently unresponsive; retry calls. `netlify.toml` lives at repo root
  with `base = "frontend"` (works — Vite auto-detected).

## Quick verification snippets
Live charge test (owner JWT):
```bash
AK=sb_publishable_FXVsKctcVMYQYzTczzxcug_8brkCsGi
JWT=$(curl -s -X POST "https://ifyvsrmdnmqlqifcqpnx.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $AK" -H "Content-Type: application/json" \
  -d '{"email":"demo@tabletree.test","password":"demo-password"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "https://ifyvsrmdnmqlqifcqpnx.supabase.co/functions/v1/deliver-booking" \
  -H "Authorization: Bearer $JWT" -H "apikey: $AK" -H "Content-Type: application/json" \
  -d '{"booking_id":"00000000-0000-0000-0000-000000000001"}'
```
Run frontend locally: `cd frontend && npm install && npm run dev` (uses `frontend/.env`). Tests: `npm test`.
