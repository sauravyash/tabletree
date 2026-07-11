# Broader Booking System (Card-Save + Staff Role) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two booking-system slices production-shaped: a real browser card-save (Stripe Elements → SetupIntent → server-side persistence) and a real staff role that can view all bookings and deliver any of them.

**Architecture:** Supabase-native. RBAC via `user_roles` + `has_role()` (already applied). Staff-read RLS is additive on top of owner-read. `deliver-booking` authorizes owner-or-staff. Card-save uses two new verify_jwt edge functions (`create-setup-intent`, `save-card`) behind a shared, mockable `StripeGateway` seam; the browser confirms a SetupIntent with Stripe Elements and `save-card` re-derives customer/PM from the retrieved intent (never trusts the client).

**Tech Stack:** Postgres/RLS (Supabase), Deno edge functions, Stripe test-mode, Vite + React 19 + TypeScript, react-router-dom v7, vitest + Testing Library, `@stripe/stripe-js` + `@stripe/react-stripe-js`.

## Global Constraints

- Supabase project ref: `ifyvsrmdnmqlqifcqpnx` (hosted; also serves prod `koslist.au`). No local Docker — apply migrations via the Supabase MCP `apply_migration`; run SQL checks via `execute_sql`; pgTAP files are for `supabase test db` reproducibility but are verified here via `execute_sql`.
- Money is integer cents. Non-negative money + quantity CHECKs exist (`0005`) — do not weaken.
- Clients never write booking state: `stripe_*`, `status`, pricing are server-owned via service-role edge functions. Client booking-UPDATE is revoked (`0005`) — do not re-grant.
- Edge functions: `verify_jwt=true` for both new functions. On **re**deploy, `deploy_edge_function` needs explicit `import_map_path: "deno.json"`.
- New Supabase secret already set: `STRIPE_SECRET_KEY`. Frontend needs `VITE_STRIPE_PUBLISHABLE_KEY` (Stripe sandbox `pk_test_…`).
- Stripe MCP cannot create SetupIntents — SetupIntent creation is verified only via the deployed edge function (real secret key) + the preview browser.
- Branch: `broader-booking-system` (already created off `main`; `0006_roles.sql` + `seed_test.sql` already committed and applied).
- Edge-fn gateway seam has NO SDK import (keeps unit tests network-free); the SDK-backed impl is isolated in a `*_real.ts` module.

---

## File Structure

**Workstream B — staff role**
- Create `supabase/migrations/0007_staff_booking_rls.sql` — staff-read policies.
- Create `supabase/tests/0005_staff_rls_test.sql` — pgTAP visibility assertions.
- Create `supabase/functions/deliver-booking/authz.ts` — pure `authorize()` helper.
- Modify `supabase/functions/deliver-booking/index.ts` — role lookup + owner-or-staff.
- Create `supabase/functions/deliver-booking/authz_test.ts` — authz unit tests.
- Modify `frontend/src/api.ts` — `listPendingBookings()`.
- Create `frontend/src/pages/StaffBookings.tsx` (+ test) — pending list.
- Modify `frontend/src/pages/StaffBooking.tsx` (+ its test) — take booking id from route param.
- Modify `frontend/src/main.tsx` — `/staff` list + `/staff/:bookingId` detail routes.

**Workstream A — card-save**
- Create `supabase/functions/_shared/stripe.ts` + `_shared/stripe_real.ts` — extended shared gateway seam.
- Modify `supabase/functions/deliver-booking/{index.ts,deliver_test.ts}` — import gateway from `_shared`; delete its local `stripe.ts`/`stripe_real.ts`.
- Create `supabase/functions/create-setup-intent/{index.ts,setup.ts,setup_test.ts,deno.json}`.
- Create `supabase/functions/save-card/{index.ts,confirm.ts,confirm_test.ts,deno.json}`.
- Modify `frontend/src/api.ts` — `createSetupIntent()`, `saveCard()`.
- Create `frontend/src/pages/CardSave.tsx` (+ test) — `/card` Elements page.
- Modify `frontend/src/main.tsx` — `/card` route.
- Modify `frontend/.env.example` — `VITE_STRIPE_PUBLISHABLE_KEY`.

---

## Task 1: Staff-read RLS

**Files:**
- Create: `supabase/migrations/0007_staff_booking_rls.sql`
- Test: `supabase/tests/0005_staff_rls_test.sql`

**Interfaces:**
- Consumes: `has_role(uuid, app_role)` from `0006_roles.sql`; seeded staff user `00000000-0000-0000-0000-0000000000f1`, demo user `…0aa`, demo booking `…001`, Alice booking `…002`.
- Produces: staff can `select` all `bookings` + `booking_items`; non-staff unchanged (own-only).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/0005_staff_rls_test.sql`:

```sql
begin;
select plan(4);

-- staff user sees ALL bookings (owns none of them)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select ok((select count(*) from bookings) >= 4, 'staff sees all bookings');
select ok((select count(*) from bookings where id='00000000-0000-0000-0000-000000000002') = 1,
          'staff sees a booking they do not own');

-- a plain customer still sees only their own
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*) from bookings where id='00000000-0000-0000-0000-000000000001'),
          0::bigint, 'non-staff cannot see another user booking');
select is((select count(*) from bookings where id='00000000-0000-0000-0000-000000000002'),
          1::bigint, 'non-staff still sees own booking');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

No Docker, so run the assertions via the Supabase MCP inside a rolled-back transaction:

```
execute_sql(project_id="ifyvsrmdnmqlqifcqpnx", query="
begin;
set local role authenticated;
select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-0000000000f1\",\"role\":\"authenticated\"}', true);
select count(*) as staff_sees from bookings;
rollback;")
```

Expected: `staff_sees = 1` or `0` (staff can only see rows they own → policy missing). This is the failing state.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0007_staff_booking_rls.sql`:

```sql
-- Additive staff-read: staff may SELECT every booking + item (for the staff
-- delivery queue). Owner-read policies from 0002 remain; no write path is opened
-- (booking state stays server-owned via the service-role edge function).
create policy "staff read all bookings" on bookings
  for select to authenticated using (has_role(auth.uid(), 'staff'));

create policy "staff read all items" on booking_items
  for select to authenticated using (has_role(auth.uid(), 'staff'));
```

- [ ] **Step 4: Apply it**

```
apply_migration(project_id="ifyvsrmdnmqlqifcqpnx", name="0007_staff_booking_rls", query="<file contents>")
```

- [ ] **Step 5: Run the assertions to verify they pass**

Run the staff-visibility query from Step 2 → expect `staff_sees >= 4`. Then the non-staff check:

```
execute_sql(project_id="ifyvsrmdnmqlqifcqpnx", query="
begin;
set local role authenticated;
select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-0000000000c1\",\"role\":\"authenticated\"}', true);
select
  (select count(*) from bookings where id='00000000-0000-0000-0000-000000000001') as sees_others,
  (select count(*) from bookings where id='00000000-0000-0000-0000-000000000002') as sees_own;
rollback;")
```

Expected: `sees_others = 0`, `sees_own = 1`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_staff_booking_rls.sql supabase/tests/0005_staff_rls_test.sql
git commit -m "feat(db): staff-read RLS for bookings and booking_items"
```

---

## Task 2: deliver-booking owner-or-staff authorization

**Files:**
- Create: `supabase/functions/deliver-booking/authz.ts`
- Create: `supabase/functions/deliver-booking/authz_test.ts`
- Modify: `supabase/functions/deliver-booking/index.ts` (the ownership guard block)

**Interfaces:**
- Consumes: `user_roles` table (`0006`).
- Produces: `authorize(booking: { user_id: string }, userId: string, isStaff: boolean): boolean`. `index.ts` computes `isStaff` from a `user_roles` lookup and gates delivery on it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/deliver-booking/authz_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { authorize } from './authz.ts';

Deno.test('owner is authorized', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u1', false), true);
});
Deno.test('staff non-owner is authorized', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u2', true), true);
});
Deno.test('non-staff non-owner is rejected', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u2', false), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd supabase/functions && deno test deliver-booking/authz_test.ts
```

Expected: FAIL — `Module not found ./authz.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `supabase/functions/deliver-booking/authz.ts`:

```ts
// Delivery is allowed for the booking owner OR any staff member. Staff status is
// resolved by the caller (a user_roles lookup) so this stays a pure, testable rule.
export function authorize(booking: { user_id: string }, userId: string, isStaff: boolean): boolean {
  return booking.user_id === userId || isStaff;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd supabase/functions && deno test deliver-booking/authz_test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into the handler**

In `supabase/functions/deliver-booking/index.ts`, add the import at the top with the others:

```ts
import { authorize } from './authz.ts';
```

Replace this block:

```ts
    // Only the booking owner may trigger delivery/charge (IDOR guard).
    // NOTE: a dedicated staff role is part of the broader booking system and is
    // out of scope here; owner-scoping is the correct guard for this demo flow.
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);
```

with:

```ts
    // Delivery/charge is allowed for the booking owner OR a staff member.
    const { data: staffRow } = await admin
      .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'staff').maybeSingle();
    if (!authorize(booking, user.id, !!staffRow)) return json({ error: 'forbidden' }, 403);
```

- [ ] **Step 6: Redeploy the function**

```
deploy_edge_function(project_id="ifyvsrmdnmqlqifcqpnx", ... , import_map_path="deno.json", verify_jwt=true)
```

- [ ] **Step 7: Verify via curl (staff delivers a booking they do not own)**

Get a staff JWT, then deliver Alice's booking `…002` (staff ≠ owner). Alice's booking has no saved card, so the expected outcome is a **200** with `status: "payment_failed"` (authorization passed; only the charge fails) — proving staff got past the 403.

```bash
AK=sb_publishable_FXVsKctcVMYQYzTczzxcug_8brkCsGi
URL=https://ifyvsrmdnmqlqifcqpnx.supabase.co
JWT=$(curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $AK" -H "Content-Type: application/json" \
  -d '{"email":"staff@tabletree.test","password":"staff-password"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "$URL/functions/v1/deliver-booking" -H "Authorization: Bearer $JWT" -H "apikey: $AK" \
  -H "Content-Type: application/json" -d '{"booking_id":"00000000-0000-0000-0000-000000000002"}'
```

Expected: `{"status":"payment_failed",...}` (HTTP 200). Then confirm a **non-staff** customer is still blocked: repeat with `bob@tabletree.test` / `test-password` against Alice's `…002` → expect `{"error":"forbidden"}` (403). Reset Alice's booking status afterward: `execute_sql(... "update bookings set status='pending' where id='00000000-0000-0000-0000-000000000002'")`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/deliver-booking/authz.ts supabase/functions/deliver-booking/authz_test.ts supabase/functions/deliver-booking/index.ts
git commit -m "feat(deliver-booking): authorize booking owner or staff"
```

---

## Task 3: Staff pending-list page + detail route

**Files:**
- Modify: `frontend/src/api.ts` (add `listPendingBookings`)
- Create: `frontend/src/pages/StaffBookings.tsx`
- Create: `frontend/src/pages/StaffBookings.test.tsx`
- Modify: `frontend/src/pages/StaffBooking.tsx` (booking id from route param)
- Modify: `frontend/src/pages/StaffBooking.test.tsx` (render within a route)
- Modify: `frontend/src/main.tsx` (routes)

**Interfaces:**
- Consumes: `getBooking`, `getBookingItems`, `getProducts`, `deliverBooking` (existing).
- Produces: `listPendingBookings(): Promise<Booking[]>`; `/staff` renders the list; `/staff/:bookingId` renders the detail.

- [ ] **Step 1: Write the failing api test**

Add to `frontend/src/api.test.ts` (follow the file's existing supabase-mock style; if it mocks `./supabase`, reuse that mock):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// (reuse the existing supabase mock in this file; shown here for completeness)
import { listPendingBookings } from './api';
import { supabase } from './supabase';

describe('listPendingBookings', () => {
  it('returns non-delivered bookings mapped to Booking', async () => {
    const rows = [{ id: 'b2', customer_name: 'Alice', email: 'a@x', slot_at: null,
      coffee_price_cents: 650, redemption_token: 't2', status: 'pending' }];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const neq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ neq }));
    (supabase.from as any) = vi.fn(() => ({ select }));
    const out = await listPendingBookings();
    expect(neq).toHaveBeenCalledWith('status', 'delivered');
    expect(out[0]).toMatchObject({ id: 'b2', customerName: 'Alice', status: 'pending' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: FAIL — `listPendingBookings` is not exported.

- [ ] **Step 3: Implement `listPendingBookings`**

Add to `frontend/src/api.ts` (reuse the existing `mapBooking`):

```ts
export async function listPendingBookings(): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings').select().neq('status', 'delivered').order('slot_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapBooking);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing list-page test**

Create `frontend/src/pages/StaffBookings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = { listPendingBookings: vi.fn() };
vi.mock('../api', () => api);

import StaffBookings from './StaffBookings';

beforeEach(() => {
  api.listPendingBookings.mockReset();
  api.listPendingBookings.mockResolvedValue([
    { id: 'b2xxxxxx', customerName: 'Alice', email: null, slotAt: null, coffeePriceCents: 650, redemptionToken: 't', status: 'pending' },
    { id: 'b3xxxxxx', customerName: 'Bob', email: null, slotAt: null, coffeePriceCents: 750, redemptionToken: 't', status: 'pending' },
  ]);
});

describe('StaffBookings', () => {
  it('lists pending bookings as links to detail', async () => {
    render(<MemoryRouter><StaffBookings /></MemoryRouter>);
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    const link = screen.getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', '/staff/b2xxxxxx');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/pages/StaffBookings.test.tsx
```

Expected: FAIL — module `./StaffBookings` not found.

- [ ] **Step 7: Implement the list page**

Create `frontend/src/pages/StaffBookings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Booking } from '../types';

export default function StaffBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('../api')
      .then((api) => api.listPendingBookings())
      .then((b) => { if (!cancelled) setBookings(b); })
      .catch(() => { if (!cancelled) setError('Could not load bookings.'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="screen">
      <div className="wrap">
        <h1>Pending deliveries</h1>
        {error && <p role="alert">{error}</p>}
        {bookings.length === 0 && !error && <p>No pending bookings.</p>}
        <ul>
          {bookings.map((b) => (
            <li key={b.id}>
              <Link to={`/staff/${b.id}`}>
                {b.customerName ?? b.id.slice(0, 8)} — {b.status} · coffee ${(b.coffeePriceCents ?? 0) / 100}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/pages/StaffBookings.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Parameterize the detail page by route**

In `frontend/src/pages/StaffBooking.tsx`, replace:

```ts
const BOOKING_ID = import.meta.env.VITE_DEMO_BOOKING_ID as string;
```

with a route param read inside the component (add `import { useParams } from 'react-router-dom';` at the top):

```ts
  const { bookingId } = useParams<{ bookingId: string }>();
```

Then in the effect use `bookingId` instead of `BOOKING_ID` for the three `api.getBooking/getBookingItems` calls, and guard: `if (!bookingId) return;` at the top of the effect body.

- [ ] **Step 10: Update the detail-page test to render within a route**

In `frontend/src/pages/StaffBooking.test.tsx`, wrap renders so the param resolves. Add imports:

```ts
import { MemoryRouter, Routes, Route } from 'react-router-dom';
```

Replace each `render(<StaffBooking />)` with:

```tsx
render(
  <MemoryRouter initialEntries={['/staff/b1']}>
    <Routes><Route path="/staff/:bookingId" element={<StaffBooking />} /></Routes>
  </MemoryRouter>,
);
```

(The `api.getBooking` mock already returns `{ id: 'b1', ... }`, so assertions are unchanged.)

- [ ] **Step 11: Add the routes**

In `frontend/src/main.tsx`, add imports and replace the single `/staff` route with two:

```tsx
import StaffBookings from './pages/StaffBookings';
```

```tsx
  { path: '/staff', element: <StaffBookings /> },
  { path: '/staff/:bookingId', element: <StaffBooking /> },
```

- [ ] **Step 12: Run the full frontend suite**

```bash
cd frontend && npm test
```

Expected: PASS (existing + new tests).

- [ ] **Step 13: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts frontend/src/pages/StaffBookings.tsx frontend/src/pages/StaffBookings.test.tsx frontend/src/pages/StaffBooking.tsx frontend/src/pages/StaffBooking.test.tsx frontend/src/main.tsx
git commit -m "feat(staff): pending-bookings list + parameterized detail route"
```

---

## Task 4: Minimal staff sign-in on /staff

**Files:**
- Modify: `frontend/src/pages/StaffBookings.tsx`
- Modify: `frontend/src/pages/StaffBookings.test.tsx`

**Interfaces:**
- Consumes: `supabase.auth` (session + `signInWithPassword`), `listPendingBookings`.
- Produces: `/staff` shows a sign-in form when the session lacks the staff role; on success it loads the list. Customer auto-signin on `/` and `/card` is untouched.

- [ ] **Step 1: Write the failing test (sign-in form shows when not staff)**

Add to `frontend/src/pages/StaffBookings.test.tsx`. Mock `../supabase` so no session and an empty `user_roles`:

```tsx
const auth = {
  getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  signInWithPassword: vi.fn(),
};
const from = vi.fn();
vi.mock('../supabase', () => ({ supabase: { auth, from } }));
```

```tsx
it('shows a staff sign-in form when the session is not staff', async () => {
  render(<MemoryRouter><StaffBookings /></MemoryRouter>);
  expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/pages/StaffBookings.test.tsx
```

Expected: FAIL — no email field rendered.

- [ ] **Step 3: Implement the staff-gate**

Update `frontend/src/pages/StaffBookings.tsx` to check staff status first and render a sign-in form otherwise. Full file:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import type { Booking } from '../types';

async function currentUserIsStaff(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data } = await supabase.from('user_roles')
    .select('role').eq('user_id', session.user.id).eq('role', 'staff').maybeSingle();
  return !!data;
}

export default function StaffBookings() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function refresh() {
    const staff = await currentUserIsStaff();
    setIsStaff(staff);
    if (staff) {
      const api = await import('../api');
      try { setBookings(await api.listPendingBookings()); }
      catch { setError('Could not load bookings.'); }
    }
  }
  useEffect(() => { refresh(); }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Sign-in failed.'); return; }
    await refresh();
  }

  if (isStaff === null) return null;

  if (!isStaff) {
    return (
      <div className="screen"><div className="wrap">
        <h1>Staff sign-in</h1>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={signIn}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit">Sign in</button>
        </form>
      </div></div>
    );
  }

  return (
    <div className="screen"><div className="wrap">
      <h1>Pending deliveries</h1>
      {error && <p role="alert">{error}</p>}
      {bookings.length === 0 && !error && <p>No pending bookings.</p>}
      <ul>
        {bookings.map((b) => (
          <li key={b.id}>
            <Link to={`/staff/${b.id}`}>
              {b.customerName ?? b.id.slice(0, 8)} — {b.status} · coffee ${(b.coffeePriceCents ?? 0) / 100}
            </Link>
          </li>
        ))}
      </ul>
    </div></div>
  );
}
```

Update the Task 3 list test: its `api` mock now also needs `../supabase` mocked with a staff session. Add to that test's setup a `../supabase` mock whose `auth.getSession` returns a session for `…f1` and `from('user_roles')…maybeSingle()` resolves `{ data: { role: 'staff' } }`, so `currentUserIsStaff()` is true and the list renders.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/StaffBookings.test.tsx
```

Expected: PASS (both the sign-in-form test and the list test).

- [ ] **Step 5: Run the full suite + typecheck**

```bash
cd frontend && npm test && npm run build
```

Expected: tests PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/StaffBookings.tsx frontend/src/pages/StaffBookings.test.tsx
git commit -m "feat(staff): gate /staff behind a staff sign-in"
```

---

## Task 5: Shared, extended Stripe gateway seam

**Files:**
- Create: `supabase/functions/_shared/stripe.ts`
- Create: `supabase/functions/_shared/stripe_real.ts`
- Modify: `supabase/functions/deliver-booking/index.ts` (import from `_shared`)
- Modify: `supabase/functions/deliver-booking/deliver_test.ts` (import type from `_shared`)
- Delete: `supabase/functions/deliver-booking/stripe.ts`, `supabase/functions/deliver-booking/stripe_real.ts`

**Interfaces:**
- Produces (`_shared/stripe.ts`):
  ```ts
  export interface ChargeResult { id: string }
  export interface CustomerResult { id: string }
  export interface SetupIntentResult { id: string; clientSecret: string }
  export interface RetrievedSetupIntent { id: string; status: string; customer: string; paymentMethod: string }
  export interface StripeGateway {
    charge(args: { amount: number; customer: string; paymentMethod: string }): Promise<ChargeResult>;
    createCustomer(args: { email: string | null }): Promise<CustomerResult>;
    createSetupIntent(args: { customer: string }): Promise<SetupIntentResult>;
    retrieveSetupIntent(id: string): Promise<RetrievedSetupIntent>;
  }
  ```
- Produces (`_shared/stripe_real.ts`): `class RealStripe implements StripeGateway`.

- [ ] **Step 1: Create the shared seam**

Create `supabase/functions/_shared/stripe.ts` with the interface block from Interfaces above (verbatim).

- [ ] **Step 2: Create the shared real implementation**

Create `supabase/functions/_shared/stripe_real.ts`:

```ts
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import type { StripeGateway } from './stripe.ts';

export class RealStripe implements StripeGateway {
  private stripe: Stripe;
  constructor(secret: string) {
    this.stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
  }
  async charge({ amount, customer, paymentMethod }: { amount: number; customer: string; paymentMethod: string }) {
    const pi = await this.stripe.paymentIntents.create({
      amount, currency: 'usd', customer, payment_method: paymentMethod, off_session: true, confirm: true,
    });
    return { id: pi.id };
  }
  async createCustomer({ email }: { email: string | null }) {
    const c = await this.stripe.customers.create(email ? { email } : {});
    return { id: c.id };
  }
  async createSetupIntent({ customer }: { customer: string }) {
    const si = await this.stripe.setupIntents.create({
      customer, usage: 'off_session', payment_method_types: ['card'],
    });
    return { id: si.id, clientSecret: si.client_secret! };
  }
  async retrieveSetupIntent(id: string) {
    const si = await this.stripe.setupIntents.retrieve(id);
    return {
      id: si.id,
      status: si.status,
      customer: (si.customer as string) ?? '',
      paymentMethod: (si.payment_method as string) ?? '',
    };
  }
}
```

- [ ] **Step 3: Point deliver-booking at the shared seam**

In `supabase/functions/deliver-booking/index.ts` change:

```ts
import { RealStripe } from './stripe_real.ts';
import type { StripeGateway } from './stripe.ts';
```

to:

```ts
import { RealStripe } from '../_shared/stripe_real.ts';
import type { StripeGateway } from '../_shared/stripe.ts';
```

In `supabase/functions/deliver-booking/deliver_test.ts` change `import type { StripeGateway } from './stripe.ts';` to `from '../_shared/stripe.ts';`. Then delete the two local files:

```bash
git rm supabase/functions/deliver-booking/stripe.ts supabase/functions/deliver-booking/stripe_real.ts
```

- [ ] **Step 4: Run deliver-booking's existing tests (regression guard)**

```bash
cd supabase/functions && deno test deliver-booking/
```

Expected: PASS (all existing deliver tests still green — the seam only moved).

- [ ] **Step 5: Redeploy + smoke-test deliver-booking**

Redeploy with `import_map_path="deno.json"`. Then re-run the Task 2 Step 7 staff-delivers-Alice curl → still `payment_failed` (HTTP 200). Reset Alice's status to `pending` afterward.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/stripe.ts supabase/functions/_shared/stripe_real.ts supabase/functions/deliver-booking/index.ts supabase/functions/deliver-booking/deliver_test.ts
git commit -m "refactor(edge): share + extend the Stripe gateway seam in _shared"
```

---

## Task 6: create-setup-intent edge function

**Files:**
- Create: `supabase/functions/create-setup-intent/setup.ts`
- Create: `supabase/functions/create-setup-intent/setup_test.ts`
- Create: `supabase/functions/create-setup-intent/index.ts`
- Create: `supabase/functions/create-setup-intent/deno.json`

**Interfaces:**
- Consumes: `_shared/stripe.ts` (`StripeGateway.createCustomer`, `createSetupIntent`).
- Produces: `resolveCustomer(booking, gateway): Promise<{ customerId: string; created: boolean }>`; POST `{ booking_id }` → `{ clientSecret }` (200), with 401/403/404 for auth/ownership.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/create-setup-intent/setup_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveCustomer } from './setup.ts';

Deno.test('reuses an existing customer', async () => {
  let called = false;
  const g = { createCustomer() { called = true; return Promise.resolve({ id: 'cus_new' }); } };
  const r = await resolveCustomer({ stripe_customer_id: 'cus_old', email: 'a@x' }, g);
  assertEquals(r, { customerId: 'cus_old', created: false });
  assertEquals(called, false);
});

Deno.test('creates a customer when none exists', async () => {
  const g = { createCustomer(args: { email: string | null }) { return Promise.resolve({ id: 'cus_' + args.email }); } };
  const r = await resolveCustomer({ stripe_customer_id: null, email: 'a@x' }, g);
  assertEquals(r, { customerId: 'cus_a@x', created: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd supabase/functions && deno test create-setup-intent/setup_test.ts
```

Expected: FAIL — `./setup.ts` not found.

- [ ] **Step 3: Implement the pure logic**

Create `supabase/functions/create-setup-intent/setup.ts`:

```ts
import type { StripeGateway } from '../_shared/stripe.ts';

// Reuse the booking's existing Stripe customer, or create one. Kept pure/testable;
// the handler persists a newly-created customer id back onto the booking.
export async function resolveCustomer(
  booking: { stripe_customer_id: string | null; email: string | null },
  gateway: Pick<StripeGateway, 'createCustomer'>,
): Promise<{ customerId: string; created: boolean }> {
  if (booking.stripe_customer_id) return { customerId: booking.stripe_customer_id, created: false };
  const c = await gateway.createCustomer({ email: booking.email });
  return { customerId: c.id, created: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd supabase/functions && deno test create-setup-intent/setup_test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the handler + deno.json**

Create `supabase/functions/create-setup-intent/deno.json` with `{ "imports": {} }`.

Create `supabase/functions/create-setup-intent/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from '../_shared/stripe_real.ts';
import { resolveCustomer } from './setup.ts';

Deno.serve(async (req) => {
  let booking_id: string | undefined;
  try { ({ booking_id } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (!booking_id) return json({ error: 'missing_booking_id' }, 400);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select('id,user_id,email,stripe_customer_id').eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const stripe = new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const { customerId, created } = await resolveCustomer(booking, stripe);
    if (created) {
      await admin.from('bookings').update({ stripe_customer_id: customerId }).eq('id', booking.id);
    }
    const si = await stripe.createSetupIntent({ customer: customerId });
    return json({ clientSecret: si.clientSecret }, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 6: Deploy (verify_jwt=true)**

```
deploy_edge_function(project_id="ifyvsrmdnmqlqifcqpnx", name="create-setup-intent", verify_jwt=true, import_map_path="deno.json", files=[index.ts, setup.ts])
```

- [ ] **Step 7: Verify via curl (owner gets a client secret)**

Sign in as Alice, call the function for her booking `…002`:

```bash
AK=sb_publishable_FXVsKctcVMYQYzTczzxcug_8brkCsGi
URL=https://ifyvsrmdnmqlqifcqpnx.supabase.co
JWT=$(curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $AK" -H "Content-Type: application/json" \
  -d '{"email":"alice@tabletree.test","password":"test-password"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "$URL/functions/v1/create-setup-intent" -H "Authorization: Bearer $JWT" -H "apikey: $AK" \
  -H "Content-Type: application/json" -d '{"booking_id":"00000000-0000-0000-0000-000000000002"}'
```

Expected: `{"clientSecret":"seti_..._secret_..."}` (HTTP 200). Confirm Alice's booking now has a `stripe_customer_id` (via `execute_sql`). Then confirm Bob's JWT against Alice's booking → `{"error":"forbidden"}` (403).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/create-setup-intent/
git commit -m "feat(edge): create-setup-intent (customer resolve + SetupIntent)"
```

---

## Task 7: save-card edge function

**Files:**
- Create: `supabase/functions/save-card/confirm.ts`
- Create: `supabase/functions/save-card/confirm_test.ts`
- Create: `supabase/functions/save-card/index.ts`
- Create: `supabase/functions/save-card/deno.json`

**Interfaces:**
- Consumes: `_shared/stripe.ts` (`retrieveSetupIntent`), the customer stamped by Task 6.
- Produces: `evaluateSetupIntent(si, expectedCustomer): { ok: true; customer; paymentMethod } | { ok: false; error }`; POST `{ booking_id, setup_intent_id }` → `{ saved: true }` (200) after stamping `stripe_payment_method_id`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/save-card/confirm_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evaluateSetupIntent } from './confirm.ts';

const ok = { status: 'succeeded', customer: 'cus_1', paymentMethod: 'pm_1' };

Deno.test('accepts a succeeded intent for the expected customer', () => {
  assertEquals(evaluateSetupIntent(ok, 'cus_1'), { ok: true, customer: 'cus_1', paymentMethod: 'pm_1' });
});
Deno.test('rejects a non-succeeded intent', () => {
  assertEquals(evaluateSetupIntent({ ...ok, status: 'requires_action' }, 'cus_1'),
    { ok: false, error: 'setup_not_succeeded' });
});
Deno.test('rejects a customer mismatch', () => {
  assertEquals(evaluateSetupIntent(ok, 'cus_other'), { ok: false, error: 'customer_mismatch' });
});
Deno.test('rejects a missing payment method', () => {
  assertEquals(evaluateSetupIntent({ ...ok, paymentMethod: '' }, 'cus_1'),
    { ok: false, error: 'no_payment_method' });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd supabase/functions && deno test save-card/confirm_test.ts
```

Expected: FAIL — `./confirm.ts` not found.

- [ ] **Step 3: Implement the pure logic**

Create `supabase/functions/save-card/confirm.ts`:

```ts
export type ConfirmResult =
  | { ok: true; customer: string; paymentMethod: string }
  | { ok: false; error: string };

// Validate a retrieved SetupIntent before trusting it to stamp a booking. The
// caller passes the booking's expected customer so a foreign intent is rejected.
export function evaluateSetupIntent(
  si: { status: string; customer: string; paymentMethod: string },
  expectedCustomer: string | null,
): ConfirmResult {
  if (si.status !== 'succeeded') return { ok: false, error: 'setup_not_succeeded' };
  if (expectedCustomer && si.customer !== expectedCustomer) return { ok: false, error: 'customer_mismatch' };
  if (!si.paymentMethod) return { ok: false, error: 'no_payment_method' };
  return { ok: true, customer: si.customer, paymentMethod: si.paymentMethod };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd supabase/functions && deno test save-card/confirm_test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Write the handler + deno.json**

Create `supabase/functions/save-card/deno.json` with `{ "imports": {} }`.

Create `supabase/functions/save-card/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from '../_shared/stripe_real.ts';
import { evaluateSetupIntent } from './confirm.ts';

Deno.serve(async (req) => {
  let booking_id: string | undefined, setup_intent_id: string | undefined;
  try { ({ booking_id, setup_intent_id } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (!booking_id || !setup_intent_id) return json({ error: 'missing_params' }, 400);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select('id,user_id,stripe_customer_id').eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const stripe = new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const si = await stripe.retrieveSetupIntent(setup_intent_id);
    const result = evaluateSetupIntent(si, booking.stripe_customer_id);
    if (!result.ok) return json({ error: result.error }, 409);

    await admin.from('bookings').update({
      stripe_customer_id: result.customer,
      stripe_payment_method_id: result.paymentMethod,
    }).eq('id', booking.id);
    return json({ saved: true }, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 6: Deploy (verify_jwt=true)**

```
deploy_edge_function(project_id="ifyvsrmdnmqlqifcqpnx", name="save-card", verify_jwt=true, import_map_path="deno.json", files=[index.ts, confirm.ts])
```

- [ ] **Step 7: End-to-end verify via Stripe test helper + curl**

Because the Stripe MCP can't confirm a SetupIntent, drive it through the Stripe API with the secret key from a shell (test mode). Create + confirm a SetupIntent for Alice's customer with `pm_card_visa`, then call `save-card`:

```bash
# (SK = the Stripe test secret key; obtain from the Stripe dashboard/MCP account info)
CUS=$(execute_sql -> select stripe_customer_id from bookings where id='...002')
SI=$(curl -s https://api.stripe.com/v1/setup_intents -u "$SK:" \
  -d customer=$CUS -d payment_method=pm_card_visa -d confirm=true -d "payment_method_types[]=card" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
# then, as Alice (JWT from Task 6):
curl -s -X POST "$URL/functions/v1/save-card" -H "Authorization: Bearer $JWT" -H "apikey: $AK" \
  -H "Content-Type: application/json" -d "{\"booking_id\":\"00000000-0000-0000-0000-000000000002\",\"setup_intent_id\":\"$SI\"}"
```

Expected: `{"saved":true}`. Confirm via `execute_sql` that Alice's booking now has a non-null `stripe_payment_method_id`. Then a staff `deliver-booking` on `…002` should now return `{"status":"delivered", ...}` — **refund** the resulting PaymentIntent via the Stripe MCP `create_refund` and reset the booking (`update bookings set status='pending', payment_intent_id=null where id='...002'`).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/save-card/
git commit -m "feat(edge): save-card (confirm SetupIntent + stamp booking)"
```

---

## Task 8: /card browser page (Stripe Elements)

**Files:**
- Modify: `frontend/package.json` (add deps)
- Modify: `frontend/.env.example` (add `VITE_STRIPE_PUBLISHABLE_KEY`)
- Modify: `frontend/src/api.ts` (`createSetupIntent`, `saveCard`)
- Create: `frontend/src/pages/CardSave.tsx`
- Create: `frontend/src/pages/CardSave.test.tsx`
- Modify: `frontend/src/main.tsx` (`/card` route)

**Interfaces:**
- Consumes: edge fns via `supabase.functions.invoke`.
- Produces: `createSetupIntent(bookingId): Promise<{ clientSecret: string }>`; `saveCard(bookingId, setupIntentId): Promise<{ saved: boolean }>`; `/card` page.

- [ ] **Step 1: Add dependencies + env**

```bash
cd frontend && npm install @stripe/stripe-js @stripe/react-stripe-js
```

Add to `frontend/.env.example`:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_sandbox_publishable_key
```

Set the real `pk_test_…` in `frontend/.env` (local) and, later, in Netlify env.

- [ ] **Step 2: Write the failing api test**

Add to `frontend/src/api.test.ts`:

```ts
describe('card-save api', () => {
  it('createSetupIntent invokes the edge fn and returns the client secret', async () => {
    (supabase.functions as any) = { invoke: vi.fn().mockResolvedValue({ data: { clientSecret: 'seti_x' }, error: null }) };
    const out = await (await import('./api')).createSetupIntent('b2');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('create-setup-intent', { body: { booking_id: 'b2' } });
    expect(out).toEqual({ clientSecret: 'seti_x' });
  });
  it('saveCard invokes the edge fn with the setup intent id', async () => {
    (supabase.functions as any) = { invoke: vi.fn().mockResolvedValue({ data: { saved: true }, error: null }) };
    const out = await (await import('./api')).saveCard('b2', 'seti_1');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('save-card', { body: { booking_id: 'b2', setup_intent_id: 'seti_1' } });
    expect(out).toEqual({ saved: true });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: FAIL — functions not exported.

- [ ] **Step 4: Implement the api functions**

Add to `frontend/src/api.ts`:

```ts
export async function createSetupIntent(bookingId: string): Promise<{ clientSecret: string }> {
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: { booking_id: bookingId } });
  if (error) throw error;
  return data as { clientSecret: string };
}

export async function saveCard(bookingId: string, setupIntentId: string): Promise<{ saved: boolean }> {
  const { data, error } = await supabase.functions.invoke('save-card', { body: { booking_id: bookingId, setup_intent_id: setupIntentId } });
  if (error) throw error;
  return data as { saved: boolean };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing page test**

Create `frontend/src/pages/CardSave.test.tsx`. Mock the Stripe React bindings and `../api`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const confirmSetup = vi.fn();
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup }),
  useElements: () => ({}),
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));

const api = { createSetupIntent: vi.fn(), saveCard: vi.fn(), getBooking: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as any), useNavigate: () => navigate }));

import CardSave from './CardSave';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  confirmSetup.mockReset(); navigate.mockReset();
  api.getBooking.mockResolvedValue({ id: 'b2', status: 'pending', coffeePriceCents: 650, customerName: 'Alice', email: 'a@x', slotAt: null, redemptionToken: 't' });
  api.createSetupIntent.mockResolvedValue({ clientSecret: 'seti_x_secret' });
});

describe('CardSave', () => {
  it('fetches a client secret and renders the payment element', async () => {
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    await waitFor(() => expect(api.createSetupIntent).toHaveBeenCalledWith('b2'));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
  });

  it('saves the card and navigates on successful confirmation', async () => {
    confirmSetup.mockResolvedValue({ setupIntent: { id: 'seti_1', status: 'succeeded' } });
    api.saveCard.mockResolvedValue({ saved: true });
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    await waitFor(() => expect(api.saveCard).toHaveBeenCalledWith('b2', 'seti_1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('surfaces a confirmation error', async () => {
    confirmSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/declined/i);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/pages/CardSave.test.tsx
```

Expected: FAIL — module `./CardSave` not found.

- [ ] **Step 8: Implement the page**

Create `frontend/src/pages/CardSave.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createSetupIntent, saveCard } from '../api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CardForm({ bookingId }: { bookingId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || working) return;
    setWorking(true); setError(null);
    const { error: confErr, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    if (confErr || !setupIntent || setupIntent.status !== 'succeeded') {
      setError(confErr?.message ?? 'Could not save the card.'); setWorking(false); return;
    }
    try {
      await saveCard(bookingId, setupIntent.id);
      navigate('/');
    } catch {
      setError('Card confirmed but saving failed. Please try again.'); setWorking(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      <button type="submit" disabled={working}>{working ? 'Saving…' : 'Save card'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export default function CardSave({ bookingId }: { bookingId: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createSetupIntent(bookingId)
      .then((r) => { if (!cancelled) setClientSecret(r.clientSecret); })
      .catch(() => { if (!cancelled) setError('Could not start card setup.'); });
    return () => { cancelled = true; };
  }, [bookingId]);

  const options = useMemo(() => (clientSecret ? { clientSecret } : undefined), [clientSecret]);

  return (
    <div className="screen"><div className="wrap">
      <h1>Save a card for your delivery</h1>
      {error && <p role="alert">{error}</p>}
      {options && (
        <Elements stripe={stripePromise} options={options}>
          <CardForm bookingId={bookingId} />
        </Elements>
      )}
    </div></div>
  );
}
```

- [ ] **Step 9: Run the page test to verify it passes**

```bash
cd frontend && npx vitest run src/pages/CardSave.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 10: Add the route**

In `frontend/src/main.tsx` add the import and route. The page needs a booking id; use the demo customer's booking env for the route wrapper:

```tsx
import CardSave from './pages/CardSave';
```

```tsx
  { path: '/card', element: <CardSave bookingId={import.meta.env.VITE_DEMO_BOOKING_ID as string} /> },
```

- [ ] **Step 11: Run the full suite + build**

```bash
cd frontend && npm test && npm run build
```

Expected: tests PASS, build clean.

- [ ] **Step 12: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env.example frontend/src/api.ts frontend/src/api.test.ts frontend/src/pages/CardSave.tsx frontend/src/pages/CardSave.test.tsx frontend/src/main.tsx
git commit -m "feat(frontend): /card Stripe Elements card-save page"
```

---

## Task 9: Full-flow browser E2E + docs + PR

**Files:**
- Modify: `README.md` (routes, edge functions, staff/card flows)
- Modify: `docs/HANDOFF.md` (mark items done)
- Create: `.claude/launch.json` if absent (for the preview server)

**Interfaces:**
- Consumes: everything above, deployed.

- [ ] **Step 1: Start the preview server**

Ensure `frontend/.env` has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_*`, and `VITE_STRIPE_PUBLISHABLE_KEY`. Start via `preview_start` (create `.claude/launch.json` with a `frontend` dev config: `runtimeExecutable npm`, `runtimeArgs ["run","dev"]`, the Vite port).

- [ ] **Step 2: Drive the card-save flow in the browser**

Navigate to `/card`. In the Stripe Payment Element iframe, enter test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Click **Save card**. Expect navigation to `/`. (Use `preview_*` tools; the Element renders in an iframe.)

- [ ] **Step 3: Assert the card was persisted**

```
execute_sql(project_id="ifyvsrmdnmqlqifcqpnx", query="select stripe_customer_id, stripe_payment_method_id from bookings where id='<demo booking>'")
```

Expected: both columns non-null.

- [ ] **Step 4: Drive the staff flow**

Navigate to `/staff`, sign in as `staff@tabletree.test` / `staff-password`. Expect the pending list (Alice, Bob, Demo — not Carol). Click the booking that now has a card, click **Mark delivered**. Expect status → `delivered`.

- [ ] **Step 5: Refund + reset**

Refund the resulting PaymentIntent via Stripe MCP `create_refund`, then `execute_sql` reset that booking to `status='pending', payment_intent_id=null`.

- [ ] **Step 6: Update docs**

In `README.md` document the new routes (`/card`, `/staff` list + `/staff/:id`) and edge functions (`create-setup-intent`, `save-card`), plus the `VITE_STRIPE_PUBLISHABLE_KEY` env and the seeded staff/customer test creds. In `docs/HANDOFF.md`, move "broader booking system" items to done and note remaining owner actions (set `VITE_STRIPE_PUBLISHABLE_KEY` in Netlify).

- [ ] **Step 7: Commit + open PR**

```bash
git add README.md docs/HANDOFF.md .claude/launch.json
git commit -m "docs: card-save + staff role flows; browser E2E verified"
git push -u origin broader-booking-system
gh pr create --base main --title "Broader booking system: real card-save + staff role" --body "<summary + test evidence>"
```

- [ ] **Step 8: Confirm the Netlify deploy check is green before merge**

`gh pr checks <n>` → `deploy/netlify` pass. Note: the deployed app needs `VITE_STRIPE_PUBLISHABLE_KEY` in Netlify env for `/card` to work in production (owner action).

---

## Self-Review notes (already reconciled)

- **Spec coverage:** B1→Task 1, B2→Task 2, B3→Tasks 3–4, A1→Task 5, A2→Task 6, A3→Task 7, A4→Task 8, testing→each task + Task 9. Fixtures/roles (B0) already applied.
- **Type consistency:** `StripeGateway` extended once in Task 5 and consumed by Tasks 6–7 with matching signatures; `resolveCustomer`/`evaluateSetupIntent`/`authorize`/`listPendingBookings`/`createSetupIntent`/`saveCard` names are used identically across definition and call sites.
- **No placeholders:** every code step shows full code; verification steps show exact commands + expected output.
