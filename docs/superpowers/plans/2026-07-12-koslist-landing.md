# KosList.au Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flower-funnel intro at `/` with the KosList.au front-door page (chips, "ask me anything" bar, product cards) and add coming-soon stubs for Jobs and Co-work.

**Architecture:** `Landing.tsx` is rewritten to the KosList layout while keeping its two existing behaviors — start a draft booking on mount, and save the "ask" text via `setBookingWish`. A new shared `ComingSoon` page is routed at `/jobs` and `/cowork`. New CSS classes are added to `index.css`, reusing existing design tokens and the shooting-star animation verbatim.

**Tech Stack:** React 19, react-router-dom v7, TypeScript, Vitest + @testing-library/react, oxlint, Vite.

## Global Constraints

- No new npm dependencies.
- Reuse existing design tokens in `src/index.css` (`--gold`, `--gold-deep`, `--gold-soft`, `--card`, `--paper`, `--ink`, `--muted`, `--line`, `--line-strong`) and fonts (Fraunces / Work Sans).
- Reuse the existing `.shooting-star`, `.wish-launch`, and `@keyframes shooting-star` / `wish-message-in` — do NOT duplicate them.
- Landing keeps reading `?store=` and calling `startDraftBooking(storeCode)` on mount, and `setBookingWish(value)` on submit — same API functions as today.
- `/` stays inside `FunnelLayout` (needs `FunnelProvider`). `/jobs` and `/cowork` are standalone (no funnel context).
- Tests: run with `npm test` (vitest) from `frontend/`. Lint with `npm run lint`.
- Honor `prefers-reduced-motion` (already handled by the reused animation CSS).

---

### Task 1: `ComingSoon` stub page + routes

**Files:**
- Create: `frontend/src/pages/ComingSoon.tsx`
- Create: `frontend/src/pages/ComingSoon.test.tsx`
- Modify: `frontend/src/main.tsx` (add two routes)

**Interfaces:**
- Produces: `ComingSoon` — default export, React component with props `{ title: string }`. Renders a heading equal to `title`, a "Coming soon." note, and a `<Link to="/">` back-home link.
- Consumes: `Link` from `react-router-dom`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/ComingSoon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ComingSoon from './ComingSoon';

describe('ComingSoon', () => {
  it('renders the section title, a coming-soon note, and a home link', () => {
    render(<MemoryRouter><ComingSoon title="Jobs" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /jobs/i })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ComingSoon`
Expected: FAIL — cannot resolve `./ComingSoon`.

- [ ] **Step 3: Create the component**

Create `frontend/src/pages/ComingSoon.tsx`:

```tsx
import { Link } from 'react-router-dom';

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="screen coming-soon">
      <p className="eyebrow">KosList.au</p>
      <h1 className="koslist-wordmark coming-soon-title">{title}</h1>
      <p className="coming-soon-note">Coming soon.</p>
      <Link to="/" className="coming-soon-home">← Back to home</Link>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- ComingSoon`
Expected: PASS.

- [ ] **Step 5: Wire the routes**

In `frontend/src/main.tsx`, add the import alongside the other page imports:

```tsx
import ComingSoon from './pages/ComingSoon';
```

Add these two entries to the top-level `createBrowserRouter` array, after the `{ path: '/bonus-flowers', ... }` line (they are standalone, NOT inside `FunnelLayout`):

```tsx
  { path: '/jobs', element: <ComingSoon title="Jobs" /> },
  { path: '/cowork', element: <ComingSoon title="Co-work" /> },
```

- [ ] **Step 6: Verify build/lint**

Run: `cd frontend && npm run lint && npm test -- ComingSoon`
Expected: lint clean; test PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ComingSoon.tsx frontend/src/pages/ComingSoon.test.tsx frontend/src/main.tsx
git commit -m "feat: add ComingSoon stub page for /jobs and /cowork"
```

---

### Task 2: Rewrite `Landing` to the KosList layout

**Files:**
- Modify: `frontend/src/funnel/Landing.tsx` (full rewrite of the return + submit handler)
- Modify: `frontend/src/funnel/Landing.test.tsx` (rewrite tests for new markup/behavior)

**Interfaces:**
- Consumes: `startDraftBooking(storeCode)`, `setBookingWish(value)` from `../api`; `useFunnel()` (`{ loading, refresh }`); `useNavigate`, `useSearchParams`.
- Produces: the `/` landing UI. Accessibility hooks the tests rely on:
  - input labelled `Ask me anything`
  - buttons named `Jobs`, `Co-work`, `Manifestables` (disabled), `KosKup`
  - inert cards `Keyboard`, `RoundTable` (NOT buttons — plain elements with `aria-disabled`)
  - animation node containing text `Wish sent`
  - no submit button in the ask bar

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `frontend/src/funnel/Landing.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const { api, navigate, refresh } = vi.hoisted(() => ({
  api: { startDraftBooking: vi.fn(), setBookingWish: vi.fn() },
  navigate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams('store=SHOP42')] }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ loading: false, refresh }) }));
import Landing from './Landing';
beforeEach(() => {
  api.startDraftBooking.mockReset(); api.setBookingWish.mockReset();
  navigate.mockReset(); refresh.mockReset();
  api.startDraftBooking.mockResolvedValue('bk-1');
});

describe('KosList Landing', () => {
  it('starts a draft with the store code from the URL', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledWith('SHOP42'));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders the wordmark, chips and cards with no submit button', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: /koslist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^jobs$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /co-work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manifestables/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /koskup/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/ask me anything/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('saves the query as a wish and shows the animation on Enter', async () => {
    api.setBookingWish.mockResolvedValue(undefined);
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.change(input, { target: { value: 'a quiet desk near a window' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.setBookingWish).toHaveBeenCalledWith('a quiet desk near a window'));
    expect(await screen.findByText(/wish sent/i)).toBeInTheDocument();
  });

  it('does nothing on Enter when the input is empty', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.submit(input.closest('form')!);
    expect(api.setBookingWish).not.toHaveBeenCalled();
  });

  it('does not save a wish until the draft is ready', async () => {
    api.startDraftBooking.mockRejectedValueOnce(new Error('not ready'));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/get things ready/i);
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    expect(api.setBookingWish).not.toHaveBeenCalled();
  });

  it('navigates from the chips and the KosKup card', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^jobs$/i }));
    expect(navigate).toHaveBeenCalledWith('/jobs');
    fireEvent.click(screen.getByRole('button', { name: /co-work/i }));
    expect(navigate).toHaveBeenCalledWith('/cowork');
    fireEvent.click(screen.getByRole('button', { name: /koskup/i }));
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });

  it('retries draft setup when it fails', async () => {
    api.startDraftBooking.mockRejectedValueOnce(new Error('Session not ready'));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- Landing`
Expected: FAIL — new markup (chips, KosKup card, "ask me anything" label) not present yet.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `frontend/src/funnel/Landing.tsx` with:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setBookingWish, startDraftBooking } from '../api';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loading, refresh } = useFunnel();
  const initialized = useRef(false);
  const resetTimer = useRef<number | null>(null);
  const [wish, setWish] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishLaunched, setWishLaunched] = useState(false);
  const storeCode = params.get('store');

  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    let cancelled = false;
    (async () => {
      try {
        await startDraftBooking(storeCode);
        await refresh();
        if (!cancelled) { setDraftReady(true); setSetupError(null); }
      } catch {
        if (!cancelled) setSetupError('We couldn’t get things ready. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [loading, setupAttempt, storeCode, refresh]);

  useEffect(() => () => { if (resetTimer.current) window.clearTimeout(resetTimer.current); }, []);

  function retrySetup() {
    initialized.current = false;
    setSetupError(null);
    setSetupAttempt((attempt) => attempt + 1);
  }

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = wish.trim();
    if (!value || !draftReady || saving) return;
    setSaving(true);
    setWishError(null);
    try {
      await setBookingWish(value);
      await refresh();
      setWish('');
      setWishLaunched(true);
      resetTimer.current = window.setTimeout(() => setWishLaunched(false), 2200);
    } catch {
      setWishError('We couldn’t send that. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen koslist-screen"><div className="koslist-wrap">
      <p className="eyebrow koslist-eyebrow">Everything, arranged</p>
      <h1 className="koslist-wordmark">KosList<span className="koslist-dot">.</span>au</h1>

      <nav className="koslist-chips" aria-label="Categories">
        <button type="button" className="koslist-chip" onClick={() => navigate('/jobs')}>Jobs</button>
        <button type="button" className="koslist-chip" onClick={() => navigate('/cowork')}>Co-work</button>
        <button type="button" className="koslist-chip" disabled aria-disabled="true">Manifestables</button>
      </nav>

      {!wishLaunched ? (
        <form className="koslist-ask" onSubmit={onAsk}>
          <span className="koslist-ask-icon" aria-hidden="true">✦</span>
          <input
            aria-label="Ask me anything"
            maxLength={500}
            placeholder="ask me anything…"
            value={wish}
            onChange={(event) => setWish(event.target.value)}
          />
        </form>
      ) : (
        <div className="koslist-ask koslist-ask--launch wish-launch" aria-live="polite">
          <span className="shooting-star" aria-hidden="true" />
          <span>Wish sent</span>
        </div>
      )}
      {setupError && <p className="koslist-error" role="alert">{setupError} <button type="button" onClick={retrySetup}>Retry</button></p>}
      {wishError && <p className="koslist-error" role="alert">{wishError}</p>}

      <div className="koslist-cards">
        <div className="koslist-card koslist-card--inert" aria-disabled="true">Keyboard</div>
        <button type="button" className="koslist-card koslist-card--active" onClick={() => navigate('/beverage')}>KosKup</button>
        <div className="koslist-card koslist-card--inert" aria-disabled="true">RoundTable</div>
      </div>
    </div></div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- Landing`
Expected: PASS (all 7).

- [ ] **Step 5: Verify lint and full test suite**

Run: `cd frontend && npm run lint && npm test`
Expected: lint clean; whole suite green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/funnel/Landing.tsx frontend/src/funnel/Landing.test.tsx
git commit -m "feat: rebuild landing as KosList.au front-door page"
```

---

### Task 3: KosList landing + ComingSoon styles

**Files:**
- Modify: `frontend/src/index.css` (append new classes; adjust obsolete landing classes if they collide)

**Interfaces:**
- Consumes: existing tokens and `.shooting-star` / `.wish-launch` rules already in `index.css`.
- Produces: visual styling for `.koslist-*` and `.coming-soon*` classes used by Tasks 1–2. No JS/test interface.

Note: CSS has no unit test; verification is visual via the preview tools (below). Keep the classes additive — do not delete the existing `.shooting-star`, `.wish-launch`, `@keyframes`, or funnel styles used by other screens.

- [ ] **Step 1: Append the styles**

Append to the end of `frontend/src/index.css`:

```css
/* ---- KosList.au landing ---- */
.koslist-screen {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: clamp(24px, 6vh, 64px) 20px; background: linear-gradient(135deg, #fffdf8 0%, #f6efe0 100%);
}
.koslist-wrap {
  width: min(100%, 760px); text-align: center;
  background: rgba(255, 255, 255, 0.72); border: 1px solid var(--line);
  border-radius: 28px; padding: clamp(28px, 5vw, 52px) clamp(20px, 5vw, 56px);
  box-shadow: 0 40px 90px -60px rgba(58, 46, 31, 0.5);
}
.koslist-eyebrow { text-align: center; margin-bottom: 18px; }
.koslist-wordmark {
  font-family: 'Fraunces', serif; font-weight: 500; letter-spacing: -0.03em;
  font-size: clamp(44px, 9vw, 76px); line-height: 1; margin: 0 0 clamp(24px, 4vw, 36px);
  color: var(--ink);
}
.koslist-dot { color: var(--gold); }

.koslist-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-bottom: clamp(20px, 3vw, 28px); }
.koslist-chip {
  border: 1px solid var(--line-strong); border-radius: 999px; background: rgba(255, 255, 255, 0.6);
  color: var(--ink); font: inherit; font-size: 15px; padding: 10px 22px; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.koslist-chip:hover:not(:disabled) { background: #fff; border-color: var(--gold-soft); }
.koslist-chip:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.6; }

.koslist-ask {
  display: flex; align-items: center; gap: 12px; min-height: 60px;
  padding: 8px 22px; margin: 0 auto clamp(20px, 3vw, 28px); max-width: 620px;
  border: 1px solid var(--line-strong); border-radius: 999px; background: #fff;
  box-shadow: 0 12px 30px -22px rgba(58, 46, 31, 0.45);
}
.koslist-ask:focus-within { border-color: var(--gold); box-shadow: 0 0 0 4px rgba(184, 137, 46, 0.13); }
.koslist-ask-icon { color: var(--gold-soft); font-size: 18px; flex: 0 0 auto; }
.koslist-ask input {
  width: 100%; min-width: 0; border: 0; outline: 0; background: transparent;
  color: var(--ink); font: inherit; font-size: 16px;
}
.koslist-ask input::placeholder { color: var(--muted); }
/* animation state reuses .wish-launch + .shooting-star from above */
.koslist-ask--launch { justify-content: center; overflow: hidden; color: var(--gold-deep); font-weight: 650; }

.koslist-error { max-width: 620px; margin: -8px auto 20px; color: #9d3726; font-size: 13px; }
.koslist-error button { margin-left: 4px; border: 0; padding: 0; background: none; color: inherit; font: inherit; font-weight: 650; text-decoration: underline; cursor: pointer; }

.koslist-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.koslist-card {
  display: flex; align-items: center; justify-content: center; min-height: 96px;
  border-radius: 16px; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 500;
  border: 1px solid var(--line-strong); background: #fff; color: var(--ink);
}
.koslist-card--inert {
  color: var(--muted); cursor: not-allowed;
  background-image: repeating-linear-gradient(45deg, rgba(58, 46, 31, 0.05) 0 10px, transparent 10px 20px);
}
.koslist-card--active {
  cursor: pointer; font: inherit; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600;
  color: var(--gold-deep); border: 1.5px solid var(--gold);
  background: linear-gradient(135deg, #fffdf6 0%, #f7ecd2 100%);
  box-shadow: 0 14px 34px -22px rgba(184, 137, 46, 0.6);
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.koslist-card--active:hover { box-shadow: 0 18px 40px -20px rgba(184, 137, 46, 0.75); transform: translateY(-1px); }

@media (max-width: 640px) {
  .koslist-cards { grid-template-columns: 1fr; }
}

/* ---- Coming soon stub ---- */
.coming-soon {
  min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; text-align: center; padding: 40px 20px;
  background: linear-gradient(135deg, #fffdf8 0%, #f6efe0 100%);
}
.coming-soon-title { font-size: clamp(34px, 8vw, 56px); margin: 0; color: var(--gold-deep); }
.coming-soon-note { color: var(--muted); font-size: 16px; margin: 0; }
.coming-soon-home { color: var(--gold); text-decoration: none; font-weight: 600; margin-top: 8px; }
.coming-soon-home:hover { text-decoration: underline; }
```

- [ ] **Step 2: Verify the tests still pass**

Run: `cd frontend && npm test`
Expected: green (CSS changes don't affect tests, but confirm nothing broke).

- [ ] **Step 3: Visual verification in the preview**

Start the dev server and confirm the landing renders like the mockup:
- `/` shows the `KosList.au` wordmark (gold dot), three chips, the "ask me anything" bar (no button), and the three product cards with KosKup highlighted.
- Typing text + pressing Enter plays the shooting-star animation.
- Clicking Jobs → `/jobs` coming-soon page; Co-work → `/cowork`; KosKup → `/beverage`.
- Manifestables, Keyboard, RoundTable are inert.
- Check narrow-viewport reflow (chips wrap, cards stack).

Use the preview tools (preview_start, preview_snapshot, preview_screenshot, preview_click) — do not ask the user to check manually.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: KosList.au landing and coming-soon page"
```

---

## Notes for the implementer

- The old two-column `.landing-*` / `.wish-composer` CSS remains in `index.css` but is no longer referenced by `Landing.tsx`. Leave it unless it visibly conflicts; a follow-up can prune it. Do NOT remove `.shooting-star` / `.wish-launch` / the keyframes — the new landing reuses them.
- Inert cards (`Keyboard`, `RoundTable`) are plain `<div>`s with `aria-disabled`, deliberately NOT buttons, so tests can distinguish the single active `KosKup` button.
- If oxlint flags the unused old CSS classes, that's fine — they are CSS, not TS. Only TS/TSX is linted.
