# Dev/Prod Environment Split — Design

**Date:** 2026-07-11
**Status:** Approved (pending spec review)

## Goal

Split the tabletree app into two isolated environments — **dev** and **prod** —
with separate databases, separate Stripe keys (sandbox vs live), and the other
splits needed to make dev a safe, ideal testing environment where a mistake can
never touch production data or take a live payment.

## Decisions (locked)

1. **DB isolation:** Supabase branching — one `tabletree` project with a
   persistent, git-linked `dev` branch that gets its own branch database. The
   production branch tracks git `main`.
2. **Git topology:** `main` = prod. Add one new long-lived `dev` branch. `main`
   is designated the Supabase + Netlify production branch. No separate `prod`
   branch is created.
3. **Frontend hosting:** one Netlify site with deploy contexts. `main` →
   production deploy (prod env vars). `dev` → branch deploy at a stable URL
   (`dev--<site>.netlify.app`) with dev env vars.
4. **Prod demo data:** audit the current prod DB, report findings, and purge the
   demo user/booking. Refactor seed so prod is never re-seeded with test data.
5. **Hardening scope:** all of it — Stripe fail-loud guard, CORS locked to known
   origins, per-branch Supabase Auth URLs documented.

## Environment matrix

| Layer | **prod** (`main`) | **dev** (`dev` branch) |
|---|---|---|
| Supabase DB | `tabletree` production branch (`ifyvsrmdnmqlqifcqpnx`) | persistent `dev` branch (own ref / URL / anon key) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | prod project values | dev branch values |
| `STRIPE_SECRET_KEY` (Supabase branch secret) | `sk_live_…` | `sk_test_…` (sandbox) |
| `VITE_STRIPE_PUBLISHABLE_KEY` (Netlify env) | `pk_live_…` | `pk_test_…` |
| Netlify context | production (from `main`) | branch-deploy (`dev`) |
| `VITE_DEMO_EMAIL` / `_PASSWORD` / `_BOOKING_ID` | **unset** | set |
| Demo seed data | **not seeded** | seeded |

## Architecture / components

### In-repo changes

1. **`supabase/config.toml` (new).** Required for branching. Declares the project
   ref, migration directory, and `[db.seed]` configuration so seeding runs only
   where intended (branches), not on the production branch.

2. **Seed refactor.** `supabase/seed.sql:30-56` currently seeds a demo auth user
   (`demo@tabletree.test`) and demo booking labelled "dev only." Move that block
   into a branch-only seed path so the production branch never seeds it. The
   product/variant/config rows that are legitimately shared can remain in the
   base seed. Exact split of "shared vs dev-only" rows to be finalized in the plan
   after reading the full seed file.

3. **Stripe fail-loud guard.** `frontend/src/pages/CardSave.tsx:7` calls
   `loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)` and silently accepts a
   placeholder. Add a guard that throws/surfaces a visible error when the key is
   missing or still a `pk_test_your_…` placeholder, so a misconfigured env fails
   obviously rather than half-working.

4. **CORS lockdown.** `supabase/functions/_shared/cors.ts` returns
   `Access-Control-Allow-Origin: *`. Replace the wildcard with an allowlist of the
   known prod + dev origins, echoing the request `Origin` header back only when it
   matches. Keeps preflight working while removing the open wildcard.

5. **Auth URL documentation.** Supabase Auth Site URL + redirect allowlist differ
   per branch (dev host vs prod host). Document the exact values to set on each
   branch so magic-link / email redirects land on the correct domain. (Dashboard
   config, not code — captured in README.)

6. **Docs.** Rewrite `frontend/.env.example` into a documented dev-vs-prod matrix
   (which vars are Netlify-context-scoped, which are Supabase branch secrets, which
   are public). Add a README section: the two-env workflow, how migrations apply
   per branch, and dev→prod promotion (merge `dev` → `main`).

7. **Create the `dev` git branch** off the current work once merged to `main`.

### Out-of-repo steps (dashboard — documented, user executes)

- Connect the GitHub repo in the Supabase dashboard; designate `main` as the
  production branch; enable branching.
- Create the persistent `dev` branch.
- Set branch-scoped secret `STRIPE_SECRET_KEY` (sandbox on `dev`, live on prod).
- In Netlify: set context-scoped env var values (prod context vs `dev` branch
  context) for `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, and the `VITE_DEMO_*` vars (unset in production).
- Set Supabase Auth Site URL / redirect URLs per branch.

## Data flow

Browser → Netlify-served bundle (env-specific `VITE_*` inlined at build) →
supabase-js against the branch's API URL/anon key → edge functions (running in
that branch, reading that branch's `STRIPE_SECRET_KEY`) → Stripe (sandbox for
dev, live for prod). No cross-environment path exists: dev bundle only knows dev
URLs/keys, prod bundle only knows prod.

## Prod data audit (one-time)

Before/alongside the seed refactor: query the current prod DB
(`ifyvsrmdnmqlqifcqpnx`) for the demo auth user (`demo@tabletree.test` /
`00000000-…-0000000000aa`) and demo booking (`00000000-…-000000000001`). Report
exactly what exists, then delete those rows (and any dependent rows) so prod
carries no test data. This is a destructive prod operation — findings will be
reported and confirmed before deletion.

## Testing / verification

- Migrations apply cleanly on a fresh branch (verified when `dev` branch is
  created).
- Frontend build succeeds with both env sets; Stripe guard throws on placeholder
  key (unit-level check).
- CORS: preflight from an allowed origin returns the origin; a disallowed origin
  does not. Existing edge-function tests stay green.
- Prod DB audit query returns zero demo rows after purge.

## Non-goals (YAGNI)

- No separate `prod` git branch (main is prod).
- No two-Netlify-site setup, no custom domains in this pass.
- No Stripe webhook handler (none exists today).
- No unrelated refactoring of edge functions beyond the CORS change.
