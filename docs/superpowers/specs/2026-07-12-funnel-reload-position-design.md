# Keep Funnel Position on Reload — Design

**Date:** 2026-07-12
**Status:** Approved (design)

## Problem

Reloading a mid-funnel step (`/beverage`, `/address`, `/slot`, `/account`, `/card`) bounces the
user back to the landing or an earlier step. The position already lives in the URL (each step is a
route) and the draft booking already persists server-side via the Supabase anon session
(`localStorage`). The bug is a **loading race**: each step guards with `if (!booking) navigate(...)`,
but on reload `booking` is `null` for a moment while `FunnelProvider` re-loads the draft, so the
guard fires before the data arrives.

## Approach

Add a single `FunnelGate` component that reads `loading` from `FunnelContext` and, while loading,
renders a brief loader instead of mounting the step page. Wrap **only the five funnel step routes**
with it. The landing (`/`) stays ungated so it keeps its instant paint (it manages its own
`draftReady` state already).

Route tree in `main.tsx`:

```
<FunnelLayout>  (FunnelProvider + Outlet)
├── /                      → Landing            (ungated)
└── <FunnelGate>           (loading ? loader : <Outlet/>)
    ├── /beverage, /address, /slot, /account, /card
```

Because step pages now mount only after the draft has resolved, their existing guards see the real
`booking`:
- Draft satisfies the step's prerequisite → user stays on that URL.
- Prerequisite genuinely missing (e.g. `/slot` with no saved postcode, or an expired slot hold) →
  redirect to the correct earlier step — but only after load, never during the flash.

No cookies, no new storage, no changes to `FunnelContext`'s data flow, and no edits to the five page
components.

## Scope

**In scope**
- New `frontend/src/funnel/FunnelGate.tsx` (`loading ? <loader/> : <Outlet/>`).
- Minimal loading style in `index.css`.
- Nest the five step routes under `<FunnelGate>` in `frontend/src/main.tsx`.
- Test `FunnelGate`: shows the loader (and does not render the step) while `loading`; renders the
  `<Outlet/>` child when loaded.

**Out of scope**
- Any "resume at furthest-completed step" logic (explicitly chosen against — stay on current URL).
- Editing the five step components (their guards are already correct once loading is respected).
- New dependencies.

## Testing

- `loading: true` → the gate renders a `role="status"` loader and the child route content is absent.
- `loading: false` → the gate renders the child route content (`<Outlet/>`).
- Existing per-page guard tests remain valid (unchanged).
- Manual: reload `/address` and `/slot` on a live draft → stays on the same URL.
