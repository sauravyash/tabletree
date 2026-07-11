# KosList.au Landing Page + Stubs — Design

**Date:** 2026-07-12
**Status:** Approved (design)

## Summary

Replace the current flower-funnel intro landing at `/` with the new **KosList.au** front-door
page ("EVERYTHING, ARRANGED"). The page presents category chips (Jobs, Co-work, Manifestables),
an "ask me anything" bar, and a row of product cards (Keyboard, KosKup, RoundTable). The existing
beverage funnel becomes what the **KosKup** card links into.

This spec covers the **landing page in full** plus **lightweight stubs** for the linked sections.
Real Jobs (Supabase-backed listing), the Co-work scheduler, and Manifestables are explicitly
**out of scope** and will each get their own spec later.

## Scope

**In scope**
- New landing page at `/` (visual + behavior matching the provided mockup).
- "Ask me anything" bar that saves the query as a booking wish (existing behavior, relocated).
- `ComingSoon` shared stub page routed at `/jobs` and `/cowork`.
- Product cards: KosKup active (→ funnel), Keyboard + RoundTable inert.
- Manifestables chip marked "coming soon", non-navigating.
- CSS for the new landing, reusing existing design tokens and the shooting-star animation.

**Out of scope (future specs)**
- Real Jobs data: new Supabase `jobs` table, listing UI, filters.
- Co-work: two-party appointment/time-blocking scheduler (availability, calendar, booking).
- Manifestables feature.
- Keyboard / RoundTable destinations (remain inert).

## Routing & structure

Current `main.tsx` router:
- `FunnelLayout` (wraps `FunnelProvider`) contains `/`, `/beverage`, `/address`, `/slot`,
  `/account`, `/card`.
- Standalone: `/bonus-flowers`, `/confirmation`, `/staff`, `/staff/:bookingId`.

Changes:
- `/` still renders inside `FunnelLayout` (the landing needs booking context so the ask bar can
  save a wish and KosKup can enter the funnel with a live draft).
- The landing's content is fully replaced (old "Let's set up your delivery" intro retired). The
  retained mechanics: start a draft booking on mount, and `setBookingWish` on submit.
- Add standalone routes `/jobs` and `/cowork`, both rendering the shared `ComingSoon` component
  (they do not need `FunnelProvider`).
- Manifestables has **no route yet** — the chip is disabled/non-navigating.

## Landing layout (matches mockup)

A single centered panel on the existing cream gradient background:

1. **Eyebrow:** `EVERYTHING, ARRANGED` (uppercase, tracked, muted — existing `.eyebrow` style).
2. **Wordmark:** `KosList.au` — Fraunces serif, large; the `.` before `au` rendered in gold
   (`--gold`) as an accent.
3. **Category chips** (pill buttons, thin border, rounded):
   - **Jobs** → navigates to `/jobs`.
   - **Co-work** → navigates to `/cowork`.
   - **Manifestables** → disabled, visually marked coming-soon (no navigation).
4. **"Ask me anything" bar** (see next section).
5. **Product card row** (three equal cards):
   - **Keyboard** — inert, hatched/disabled styling.
   - **KosKup** — active: gold border + soft glow (as in mockup) → navigates to `/beverage`.
   - **RoundTable** — inert, hatched/disabled styling.

Responsive: stack/reflow gracefully on narrow viewports (chips wrap, cards stack).

## "Ask me anything" bar (relocated wish bar)

Replaces the old `.wish-composer` (which had a submit `↑` button).

- Full-width input inside a rounded, bordered container with a leading sparkle glyph (`✦`) and
  placeholder `ask me anything…`. **No submit button.**
- On mount (unchanged from today): `startDraftBooking(storeCode)` then `refresh()`; track
  `draftReady`. The `?store=` query param is still read.
- **Enter** (form submit) with non-empty, trimmed input and `draftReady === true`:
  1. Call `setBookingWish(value)` then `refresh()` (existing `saveWish` logic).
  2. On success: hide the input and show the existing `.wish-launch` shooting-star animation
     ("Wish sent"), then reset back to the input after the animation so the user can ask again.
  3. On failure: surface the existing inline error; keep the input.
- Empty input or not-yet-ready draft: Enter is a no-op.
- Reuse `.shooting-star` / `.wish-launch` / `@keyframes shooting-star` verbatim. Honor the
  existing `prefers-reduced-motion` handling.

The setup-error / retry affordance from the current landing is retained (draft-booking setup can
fail; the ask bar must still be able to recover).

## `ComingSoon` stub page

A minimal shared component (`src/pages/ComingSoon.tsx`) taking a `title` prop:
- KosList wordmark, `"{title} — coming soon"`, and a link back to `/`.
- Rendered by `/jobs` (title "Jobs") and `/cowork` (title "Co-work").
- Deliberately trivial so the real features replace it later.

## Styling

Extend `src/index.css`:
- New classes for the KosList landing (wordmark + gold accent dot, chip row/chips, ask bar,
  product-card grid, hatched inactive cards, active-card glow).
- Reuse existing tokens: `--gold`, `--gold-deep`, `--gold-soft`, `--card`, `--paper`, `--ink`,
  `--muted`, `--line`, `--line-strong`, Fraunces/Work Sans.
- Reuse `.shooting-star`, `.wish-launch`, and the keyframes as-is.
- Remove or supersede landing-specific classes that no longer apply (`.landing-head`,
  `.wish-composer` button, two-column `.landing-wrap` grid) as needed; keep shared ones.

## Components / files touched

- `src/funnel/Landing.tsx` — rewritten to the KosList layout; keeps draft-start + wish-save logic.
- `src/pages/ComingSoon.tsx` — new shared stub.
- `src/main.tsx` — add `/jobs` and `/cowork` routes.
- `src/index.css` — new landing styles.
- `src/funnel/Landing.test.tsx` — update to cover: chips navigate, KosKup navigates to
  `/beverage`, Enter saves wish + shows animation (no submit button), Manifestables inert.

## Testing

- Landing renders wordmark, three chips, ask bar (no button), three product cards.
- Enter on the ask bar with text calls `setBookingWish` and reveals the animation; empty Enter is
  a no-op; not-ready draft blocks submission.
- Jobs / Co-work chips navigate to their routes; Manifestables does not navigate.
- KosKup card navigates to `/beverage`; Keyboard/RoundTable do not navigate.
- `ComingSoon` renders its title and a home link.

## Risks / notes

- The landing still creates a draft booking on load even though most visitors won't book — this
  matches current behavior and is required for the wish + KosKup flow. Acceptable for now.
- Keyboard/RoundTable/Manifestables are intentionally dead ends until their specs land; ensure
  they read as "coming soon" rather than broken.
