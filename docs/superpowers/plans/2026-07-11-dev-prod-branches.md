# Dev/Prod Environment Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split tabletree into isolated `dev` and `prod` environments via Supabase branching, with separate databases, separate Stripe keys (sandbox vs live), and the hardening/hygiene splits that make `dev` a safe testing environment.

**Architecture:** One `tabletree` Supabase project with git `main` as the production branch and a persistent `dev` branch (own DB/URL/keys). One Netlify site with deploy contexts (production ← `main`, branch-deploy ← `dev`) supplying env-specific `VITE_*` values. Stripe secret keys live as per-branch Supabase secrets (sandbox on dev, live on prod); publishable keys as per-context Netlify env vars. In-repo changes make the split correct and safe; dashboard steps (documented in a runbook) wire it up.

**Tech Stack:** Supabase (Postgres 17, branching, Deno edge functions), Vite/React (TypeScript), Vitest, Netlify, Stripe.

## Global Constraints

- Edge-function shared code stays **network-free in tests** — no SDK imports in files that tests import directly (mirrors existing `stripe.ts` vs `stripe_real.ts` seam).
- `VITE_*` vars are public by design (Vite inlines them); never put secret keys behind a `VITE_` prefix.
- Demo/test data (`demo@tabletree.test`, booking `00000000-0000-0000-0000-000000000001`) must never exist in the prod database.
- Supabase project ref (prod): `ifyvsrmdnmqlqifcqpnx`.
- Frontend test runner: `cd frontend && npm run test` (Vitest). Edge-function tests: `deno test` under `supabase/functions`.
- Follow existing file conventions; do not restructure unrelated code.

---

### Task 1: Supabase branching config + seed split

Adds the `config.toml` that branching requires and moves the dev-only demo rows out of the shared seed into `seed_dev.sql`. Seeds run on non-production branches (and local `supabase db reset`) — never on the production branch — so this file split plus Task 4's purge is what keeps prod clean.

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/seed_dev.sql`
- Modify: `supabase/seed.sql` (remove lines 30-57, the demo user/identity/booking)

**Interfaces:**
- Produces: `supabase/seed.sql` (shared catalog only), `supabase/seed_dev.sql` (demo user `00000000-…-0000000000aa` + identity + booking `00000000-…-000000000001`), and a `[db.seed]` config listing both paths.

- [ ] **Step 1: Create `supabase/config.toml`**

```toml
# Supabase project config. Consumed by the CLI and by branching (the production
# branch = git main; a persistent `dev` branch gets its own database). Only the
# sections we deliberately set are listed; everything else uses Supabase defaults.
project_id = "ifyvsrmdnmqlqifcqpnx"

[db.seed]
# Seeds run on non-production branches and on local `supabase db reset`.
# They do NOT run on the production branch. seed.sql = shared catalog data;
# seed_dev.sql = demo user/booking that must never reach prod.
enabled = true
sql_paths = ["./seed.sql", "./seed_dev.sql"]
```

- [ ] **Step 2: Create `supabase/seed_dev.sql`** (move the demo block verbatim from `seed.sql:30-57`)

```sql
-- DEV-ONLY seed. Runs on non-production branches and local `supabase db reset`,
-- never on the production branch. Keeps demo credentials out of prod.

-- Demo Supabase Auth user (dev only). Password: 'demo-password'
-- NOTE: confirmation_token/recovery_token/email_change_token_new/email_change
-- must be '' (not NULL). GoTrue scans them into non-nullable Go strings, and a
-- NULL there yields "Database error querying schema" on sign-in.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'demo@tabletree.test',
        crypt('demo-password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000aa',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"demo@tabletree.test"}'::jsonb,
        'email', now(), now(), now())
on conflict do nothing;

-- Demo booking (steps 1-6 assumed done; stripe fields filled separately)
insert into bookings (id, user_id, customer_name, email, slot_at, coffee_price_cents,
                      redemption_token, status)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa',
        'Demo Customer', 'demo@tabletree.test', now() + interval '1 day', 500,
        'demo-redeem-01', 'pending')
on conflict (id) do nothing;
```

- [ ] **Step 3: Remove the demo block from `supabase/seed.sql`**

Delete lines 30-57 (everything from the `-- Demo Supabase Auth user (dev only).` comment through the demo booking insert and its `on conflict (id) do nothing;`). The file must end after the `variant_options` insert block (line 28), leaving only shared catalog data (`app_config`, `products`, `product_variants`, `variant_options`).

- [ ] **Step 4: Verify the split with grep assertions**

```bash
cd supabase
# demo rows moved OUT of seed.sql:
! grep -q "demo@tabletree.test" seed.sql && echo "OK: seed.sql clean"
# demo rows present in seed_dev.sql:
grep -q "demo@tabletree.test" seed_dev.sql && echo "OK: seed_dev has demo"
# shared catalog still in seed.sql:
grep -q "insert into products" seed.sql && echo "OK: catalog intact"
```
Expected: three `OK:` lines.

- [ ] **Step 5: (If Supabase CLI + Docker available) verify seeds apply cleanly**

```bash
cd supabase && supabase db reset
```
Expected: reset completes, both seed files run without error. If the CLI/Docker is not installed, skip — branch creation in the runbook (Task 6) exercises the seed path.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/seed_dev.sql supabase/seed.sql
git commit -m "feat(db): add branching config; split demo seed into seed_dev.sql

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Stripe publishable-key fail-loud guard

Today `loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)` (`CardSave.tsx:7`) silently accepts the `.env.example` placeholder, so a misconfigured environment half-works. Add a guarded accessor that throws on a missing/placeholder/malformed key, and evaluate it inside the card page (not at module load) so unrelated routes never crash.

**Files:**
- Create: `frontend/src/stripe.ts`
- Create: `frontend/src/stripe.test.ts`
- Modify: `frontend/src/pages/CardSave.tsx` (remove module-scope const at line 7; compute inside the component)

**Interfaces:**
- Produces: `stripePublishableKey(): string` in `frontend/src/stripe.ts` — returns the validated key or throws `Error` if missing, still the placeholder, or not `pk_`-prefixed.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/stripe.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { stripePublishableKey } from './stripe';

afterEach(() => vi.unstubAllEnvs());

describe('stripePublishableKey', () => {
  it('throws when the key is missing', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');
    expect(() => stripePublishableKey()).toThrow(/missing|placeholder/i);
  });

  it('throws when the key is still the example placeholder', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_your_stripe_sandbox_publishable_key');
    expect(() => stripePublishableKey()).toThrow(/placeholder/i);
  });

  it('throws when the key is not a pk_ key', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'sk_live_oops');
    expect(() => stripePublishableKey()).toThrow(/pk_/i);
  });

  it('returns a real publishable key unchanged', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_realkey123');
    expect(stripePublishableKey()).toBe('pk_test_realkey123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stripe.test.ts`
Expected: FAIL — cannot resolve `./stripe` / `stripePublishableKey is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/stripe.ts`:

```ts
// Guarded accessor for the Stripe publishable key. Fails loudly when the env is
// missing/placeholder/malformed instead of letting Stripe half-initialize.
const PLACEHOLDER = 'pk_test_your_stripe_sandbox_publishable_key';

export function stripePublishableKey(): string {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  if (!key || key === PLACEHOLDER) {
    throw new Error(
      'VITE_STRIPE_PUBLISHABLE_KEY is missing or a placeholder. Set a real key: ' +
        'pk_test_… on dev, pk_live_… on prod.',
    );
  }
  if (!key.startsWith('pk_')) {
    throw new Error(`VITE_STRIPE_PUBLISHABLE_KEY must be a pk_ publishable key, got "${key.slice(0, 3)}…".`);
  }
  return key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/stripe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use the guard in `CardSave.tsx`**

In `frontend/src/pages/CardSave.tsx`:

Change the imports at the top — add `stripePublishableKey` and ensure `useMemo` is imported (it already is on line 1):

```ts
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createSetupIntent, saveCard } from '../api';
import { stripePublishableKey } from '../stripe';
```

Delete the module-scope constant (old line 7):

```ts
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
```

Inside the default-export `CardSave` component, add the memoized promise alongside the existing hooks (after the `useState` lines, before the `useEffect`):

```ts
  const stripePromise = useMemo(() => loadStripe(stripePublishableKey()), []);
```

The existing `<Elements stripe={stripePromise} options={options}>` now references the component-scoped `stripePromise` — no change needed there.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm run test`
Expected: PASS — all existing tests plus the 4 new ones. (Existing `CardSave`/`Confirmation` tests must stay green.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stripe.ts frontend/src/stripe.test.ts frontend/src/pages/CardSave.tsx
git commit -m "feat(frontend): fail loudly on missing/placeholder Stripe publishable key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: CORS allowlist (replace wildcard)

`_shared/cors.ts` returns `Access-Control-Allow-Origin: *`. Replace the static object with a request-aware resolver driven by an `ALLOWED_ORIGINS` env var (comma-separated, set per Supabase branch). When set, only a matching `Origin` is echoed back; when unset (local/unconfigured), fall back to echoing the request origin and log a warning — so nothing breaks before origins are configured, but production (with the var set) is locked down.

**Files:**
- Modify: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/cors_test.ts`
- Modify: `supabase/functions/save-card/index.ts`
- Modify: `supabase/functions/create-setup-intent/index.ts`
- Modify: `supabase/functions/deliver-booking/index.ts`

**Interfaces:**
- Produces: `corsHeaders(req: Request): Record<string, string>` in `_shared/cors.ts` — resolves `Access-Control-Allow-Origin` from `ALLOWED_ORIGINS` and the request `Origin`, always includes `Vary: Origin` and the existing allow-headers/methods.
- Consumes: `Deno.env.get('ALLOWED_ORIGINS')`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/cors_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

function reqWithOrigin(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  return new Request('https://fn.example/x', { method: 'OPTIONS', headers });
}

Deno.test('echoes an allowed origin when ALLOWED_ORIGINS is set', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example,https://dev--app.netlify.app');
  const h = corsHeaders(reqWithOrigin('https://dev--app.netlify.app'));
  assertEquals(h['Access-Control-Allow-Origin'], 'https://dev--app.netlify.app');
  assertEquals(h['Vary'], 'Origin');
  Deno.env.delete('ALLOWED_ORIGINS');
});

Deno.test('omits Allow-Origin for a disallowed origin when list is set', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example');
  const h = corsHeaders(reqWithOrigin('https://evil.example'));
  assertEquals(h['Access-Control-Allow-Origin'], undefined);
  Deno.env.delete('ALLOWED_ORIGINS');
});

Deno.test('falls back to echoing origin when ALLOWED_ORIGINS is unset', () => {
  Deno.env.delete('ALLOWED_ORIGINS');
  const h = corsHeaders(reqWithOrigin('http://localhost:5173'));
  assertEquals(h['Access-Control-Allow-Origin'], 'http://localhost:5173');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test _shared/cors_test.ts --allow-env`
Expected: FAIL — `corsHeaders` is not a function (currently an object).

- [ ] **Step 3: Rewrite `_shared/cors.ts`**

```ts
// CORS headers for browser callers (supabase-js `functions.invoke` sends an
// Authorization + apikey + content-type POST, which triggers a preflight). The
// OPTIONS preflight must return these headers or the browser blocks the POST;
// every real response carries them too so the browser can read the body.
//
// Allowed origins come from the ALLOWED_ORIGINS secret (comma-separated), set
// per Supabase branch (prod site on prod, dev site + localhost on dev). When the
// var is unset (local/unconfigured) we echo the request origin and warn, so
// nothing breaks before origins are configured.
const BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

function resolveAllowOrigin(origin: string | null): string | null {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) {
    if (origin) console.warn('ALLOWED_ORIGINS unset; echoing request origin', origin);
    return origin;
  }
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const allow = resolveAllowOrigin(req.headers.get('Origin'));
  return allow ? { ...BASE, 'Access-Control-Allow-Origin': allow } : { ...BASE };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test _shared/cors_test.ts --allow-env`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the three function call sites**

In each of `save-card/index.ts`, `create-setup-intent/index.ts`, `deliver-booking/index.ts`:

Change the OPTIONS line from:
```ts
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
```
to:
```ts
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
```

Change the `json` helper (module-scope) to accept resolved headers. Replace:
```ts
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } });
}
```
with:
```ts
function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });
}
```

Then, at the top of each `Deno.serve(async (req) => {` handler body, add:
```ts
  const cors = corsHeaders(req);
```
and update every `json(...)` call in that file to pass `cors` as the final argument, e.g. `return json({ error: 'unauthorized' }, 401, cors);` and `return json({ saved: true }, 200, cors);`. (In `deliver-booking/index.ts`, apply the same to all its `json(...)` returns.)

- [ ] **Step 6: Run all edge-function tests**

Run: `cd supabase/functions && deno test --allow-env`
Expected: PASS — new cors tests plus existing `*_test.ts` suites stay green (they don't import `corsHeaders`, so they're unaffected).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/cors_test.ts \
  supabase/functions/save-card/index.ts supabase/functions/create-setup-intent/index.ts \
  supabase/functions/deliver-booking/index.ts
git commit -m "feat(functions): CORS allowlist from ALLOWED_ORIGINS instead of wildcard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Audit and purge demo data from the prod database

The current prod DB (`ifyvsrmdnmqlqifcqpnx`) was set up as a single project and likely already contains the demo user/booking. This is a **destructive live-DB operation** performed via the Supabase MCP tools — report findings and get explicit confirmation before deleting.

**Files:** none (runtime operation via Supabase MCP `execute_sql`).

**Interfaces:** none.

- [ ] **Step 1: Audit — report what exists (read-only)**

Run via Supabase MCP `execute_sql` against project `ifyvsrmdnmqlqifcqpnx`:

```sql
select 'auth.users' as tbl, count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000aa'
union all
select 'auth.identities', count(*) from auth.identities where user_id = '00000000-0000-0000-0000-0000000000aa'
union all
select 'bookings (demo id)', count(*) from bookings where id = '00000000-0000-0000-0000-000000000001'
union all
select 'bookings (demo email)', count(*) from bookings where email = 'demo@tabletree.test';
```

Also check for booking-dependent rows so the delete order is known:

```sql
select 'booking_items' as tbl, count(*) from booking_items
  where booking_id in (select id from bookings where email = 'demo@tabletree.test');
```
(If `booking_items` or other child tables don't exist, note it and skip.)

- [ ] **Step 2: Report findings to the user and get explicit confirmation**

Post the counts. State exactly which rows will be deleted. **Do not proceed to Step 3 without an explicit "yes."**

- [ ] **Step 3: Purge (only after confirmation)**

Run via `execute_sql`, children before parents:

```sql
begin;
delete from booking_items where booking_id in (select id from bookings where email = 'demo@tabletree.test');
delete from bookings where email = 'demo@tabletree.test' or id = '00000000-0000-0000-0000-000000000001';
delete from auth.identities where user_id = '00000000-0000-0000-0000-0000000000aa';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000aa';
commit;
```
(Drop the `booking_items` line if Step 1 showed that table absent. Add any other child tables surfaced in Step 1 before the `bookings` delete.)

- [ ] **Step 4: Verify prod is clean**

Re-run the Step 1 audit query. Expected: every count is `0`. Report the result to the user.

---

### Task 5: Docs — env matrix + dashboard runbook

Turn `.env.example` into a documented dev-vs-prod matrix and add a README runbook covering branching setup, Netlify contexts, per-branch Stripe secrets, Supabase Auth URLs, and dev→prod promotion. Also drop the now-unused `VITE_DEMO_*` vars from `.env.example` (no code reads them after the onboarding-funnel refactor) and from the Netlify secrets-scan allowlist.

**Files:**
- Modify: `frontend/.env.example`
- Modify: `netlify.toml` (remove the dead `VITE_DEMO_*` entries from `SECRETS_SCAN_OMIT_KEYS`)
- Modify: `README.md` (add an "Environments (dev/prod)" section)

**Interfaces:** none (documentation).

- [ ] **Step 1: Rewrite `frontend/.env.example`**

```bash
# Copy to frontend/.env for LOCAL dev. In deployment, these are set as Netlify
# build environment variables, scoped PER CONTEXT (production ← main branch,
# branch-deploy ← dev branch). Values differ per environment — see the table below.
#
# All VITE_* vars are PUBLIC (Vite inlines them into the client bundle by design).
# netlify.toml's SECRETS_SCAN_OMIT_PATHS keeps the secrets scanner from flagging them.
#
# | var                          | dev (dev branch)         | prod (main)              |
# |------------------------------|--------------------------|--------------------------|
# | VITE_SUPABASE_URL            | dev branch API URL       | prod project API URL     |
# | VITE_SUPABASE_ANON_KEY       | dev branch anon key      | prod project anon key    |
# | VITE_STRIPE_PUBLISHABLE_KEY  | pk_test_… (sandbox)      | pk_live_… (live)         |
#
# Stripe SECRET keys are NOT here — they live as the STRIPE_SECRET_KEY secret on
# each Supabase branch (sk_test_ on dev, sk_live_ on prod). See README > Environments.

# Prod Supabase project "tabletree" (ref ifyvsrmdnmqlqifcqpnx). For LOCAL dev,
# point these at your dev branch instead.
VITE_SUPABASE_URL=https://ifyvsrmdnmqlqifcqpnx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_FXVsKctcVMYQYzTczzxcug_8brkCsGi

# Stripe publishable key. Use a sandbox pk_test_ key for local/dev.
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_sandbox_publishable_key
```

- [ ] **Step 2: Trim the Netlify secrets-scan allowlist**

In `netlify.toml`, change:
```toml
  SECRETS_SCAN_OMIT_KEYS = "VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY,VITE_DEMO_EMAIL,VITE_DEMO_PASSWORD,VITE_DEMO_BOOKING_ID"
```
to:
```toml
  SECRETS_SCAN_OMIT_KEYS = "VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY,VITE_STRIPE_PUBLISHABLE_KEY"
```

- [ ] **Step 3: Add an "Environments (dev/prod)" section to `README.md`**

Append this section (adjust any project-specific wording to match the README's voice):

```markdown
## Environments (dev/prod)

Two isolated environments via Supabase branching. `main` is the production
branch; a persistent `dev` branch has its own database, API URL, keys, and
edge-function secrets. A dev mistake can never touch prod data or take a live payment.

| Layer | prod (`main`) | dev (`dev` branch) |
|---|---|---|
| Supabase DB | tabletree production branch (`ifyvsrmdnmqlqifcqpnx`) | persistent `dev` branch |
| VITE_SUPABASE_URL / ANON_KEY | prod project values | dev branch values |
| STRIPE_SECRET_KEY (Supabase secret) | sk_live_… | sk_test_… |
| VITE_STRIPE_PUBLISHABLE_KEY (Netlify env) | pk_live_… | pk_test_… |
| ALLOWED_ORIGINS (Supabase secret) | prod site origin | dev site origin + http://localhost:5173 |
| Netlify | production context (← main) | branch-deploy context (← dev) |

### One-time setup (dashboards)

1. **Supabase branching:** Dashboard → project `tabletree` → connect the GitHub
   repo, designate `main` as the production branch, enable branching. Create a
   persistent branch named `dev`. Migrations in `supabase/migrations/` auto-apply
   to each branch; `seed.sql` + `seed_dev.sql` seed non-production branches.
2. **Supabase secrets (per branch):** set `STRIPE_SECRET_KEY` (sk_test_ on dev,
   sk_live_ on prod) and `ALLOWED_ORIGINS` (comma-separated site origins).
3. **Netlify:** one site. Set env var VALUES per context — production context
   (main) gets the prod Supabase URL/anon + pk_live_ publishable key; the `dev`
   branch-deploy context gets the dev branch URL/anon + pk_test_ key.
4. **Supabase Auth URLs (per branch):** Authentication → URL Configuration. Set
   the Site URL and Redirect URLs to that branch's host (dev site URL for dev,
   prod site URL for prod) so email/magic-link redirects land correctly.

### dev → prod promotion

Merge `dev` → `main`. Netlify redeploys the production context; Supabase applies
any new migrations to the production branch. Because seeds never run on the
production branch, no demo data is introduced.
```

- [ ] **Step 4: Verify the frontend still builds (env docs don't break the build)**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/.env.example netlify.toml README.md
git commit -m "docs: env matrix + dev/prod branching runbook; drop dead VITE_DEMO vars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Create the `dev` git branch and hand off dashboard steps

Final step — after the in-repo work merges to `main`, create the long-lived `dev` branch and hand the user the dashboard runbook.

**Files:** none (git + handoff).

**Interfaces:** none.

- [ ] **Step 1: Ensure this work is merged to `main`**

The in-repo changes (Tasks 1-3, 5) should be reviewed and merged to `main` first (via the normal PR flow), since `main` is the production branch and the seed/config must exist on it before branching is enabled.

- [ ] **Step 2: Create the `dev` branch from `main`**

```bash
git checkout main && git pull
git branch dev main
git push -u origin dev
```
Expected: `dev` exists locally and on origin, pointing at the same commit as `main`.

- [ ] **Step 3: Hand off the dashboard runbook**

Point the user at `README.md` > "Environments (dev/prod)" > "One-time setup (dashboards)" and confirm they have their live + sandbox Stripe keys ready to paste into Supabase secrets (secret keys) and Netlify env (publishable keys). These steps require dashboard access and cannot be done from the repo.

---

## Notes for the implementer

- **Test commands vary by layer:** frontend uses Vitest (`npm run test` in `frontend/`); edge functions use `deno test` in `supabase/functions/` (pass `--allow-env` for the CORS test).
- **Task 4 is destructive and gated** — never run the purge without the user's explicit confirmation of the audit findings.
- **Order:** Tasks 1-3 and 5 are repo changes and can proceed in any order. Task 4 (prod purge) is independent but should be done once, coordinated with the user. Task 6 is last (needs the repo work on `main`).
