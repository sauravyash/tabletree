# Category Choice + Reciprocal Free-Gift Bonus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer choose up front whether they're buying a beverage or a flower, buy one priced item from that category, then receive one free gift from the opposite category on the `/bonus` page.

**Architecture:** Beverages become `products` rows with a `category` flag alongside flowers. A new `/choose` step sets `bookings.purchase_category`; category-specific selection pages add the paid item as a `booking_item`. The renamed `/bonus` page reads `purchase_category`, shows the opposite category price-free, and lets the user add exactly one `is_gift` item.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + @testing-library/react (co-located `*.test.tsx`), Supabase Postgres (SECURITY DEFINER RPCs, RLS, pgtap tests), react-router-dom.

## Global Constraints

- Category values are exactly the strings `'beverage'` and `'flower'` everywhere (DB check constraints, TS unions, API args).
- Payment is **display-only**: prices are shown but nothing is auto-charged; the existing Stripe setup-intent card-save flow is unchanged.
- **`booking_items` price is snapshotted server-side** by the `guard_booking_item()` BEFORE-INSERT trigger (see Task 10): `$0` for gifts (`is_gift=true`), the variant's `price_cents` (or `$0` when the variant is unpriced, e.g. flowers) for paid items. **The client never sets the price**; `addBookingItem` passes a `0` placeholder and the trigger overwrites it.
- Beverage path selects **exactly one** beverage (re-selecting replaces the prior beverage). Flower path is a **cart** (add/remove multiple flowers via `ProductCard`). The `/bonus` page adds **exactly one** gift (re-selecting replaces it).
- New Step-2 pages (`/choose`, `/beverage`, `/flower`) use the eyebrow label **"Step 2 of 6"**; Address stays "Step 3 of 6", Card stays "Step 6 of 6".
- Frontend unit tests mock `../api` — they do not require a live database.
- Run frontend tests with `npm test` (i.e. `vitest run`) from `frontend/`.
- Commit after each task's tests pass.

---

## File Structure

**Supabase**
- Create `supabase/migrations/0010_categories_and_gifts.sql` — new columns, constraints, `set_purchase_category` RPC.
- Create `supabase/tests/0007_categories_test.sql` — pgtap schema assertions.
- Modify `supabase/seed.sql` + `supabase/seed_dev.sql` — beverage products; `category` on existing rows.

**Frontend**
- Modify `frontend/src/types.ts` — `Product.category`, `BookingItem.isGift`.
- Modify `frontend/src/api.ts` — `getProductsByCategory`, `setPurchaseCategory`, `addBookingItem` signature, mappers.
- Modify `frontend/src/money.ts` — `formatMoney`.
- Create `frontend/src/funnel/gift.ts` (+ `gift.test.ts`) — pure gift-selection helpers.
- Create `frontend/src/funnel/Choose.tsx` (+ test) — the category choice step.
- Modify `frontend/src/funnel/Beverage.tsx` (+ test) — priced beverage selection.
- Create `frontend/src/funnel/Flower.tsx` (+ test) — priced flower selection.
- Create `frontend/src/pages/Bonus.tsx` (+ test); delete `frontend/src/pages/FloralCollection.tsx` (+ test).
- Modify `frontend/src/main.tsx` — routes.
- Modify `frontend/src/funnel/Landing.tsx` (+ test) — KosKup → `/choose`.
- Modify `frontend/src/funnel/Card.tsx` — navigate to `/bonus`.

---

## Task 1: DB migration — categories, gift flag, purchase_category, RPC

**Files:**
- Create: `supabase/migrations/0010_categories_and_gifts.sql`
- Create: `supabase/tests/0007_categories_test.sql`

**Interfaces:**
- Produces: `products.category text`, `bookings.purchase_category text`, `booking_items.is_gift boolean`, nullable `product_variants.flower_count`/`foliage_level`, RPC `set_purchase_category(p_category text)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_categories_and_gifts.sql`:

```sql
-- Beverages join flowers in the products table via a category flag; a booking records
-- which category the customer is buying (drives the reciprocal free gift on /bonus);
-- booking_items gains an is_gift flag so the free gift charges $0.

alter table products
  add column if not exists category text not null default 'flower';
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('beverage','flower'));

-- Beverages carry neither flower_count nor foliage_level.
alter table product_variants alter column flower_count drop not null;
alter table product_variants alter column foliage_level drop not null;

alter table bookings
  add column if not exists purchase_category text;
alter table bookings drop constraint if exists bookings_purchase_category_check;
alter table bookings add constraint bookings_purchase_category_check
  check (purchase_category is null or purchase_category in ('beverage','flower'));

alter table booking_items
  add column if not exists is_gift boolean not null default false;

create or replace function set_purchase_category(p_category text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_category not in ('beverage','flower') then raise exception 'bad_category'; end if;
  update bookings set purchase_category = p_category
    where user_id = auth.uid() and status = 'draft';
  if not found then raise exception 'no_draft_booking'; end if;
end; $$;

grant execute on function set_purchase_category(text) to authenticated;
```

- [ ] **Step 2: Write the pgtap schema test**

Create `supabase/tests/0007_categories_test.sql`:

```sql
begin;
select plan(5);
select has_column('products', 'category', 'products has category');
select has_column('bookings', 'purchase_category', 'bookings has purchase_category');
select has_column('booking_items', 'is_gift', 'booking_items has is_gift');
select col_is_null('product_variants', 'flower_count', 'flower_count is nullable');
select has_function('public', 'set_purchase_category', array['text'], 'set_purchase_category exists');
select * from finish();
rollback;
```

- [ ] **Step 3: Apply the migration locally and run the test**

Run: `supabase db reset` (applies migrations + seed), then `supabase test db`
Expected: `0007_categories_test.sql .. ok` (5/5 pass). If `supabase` CLI/local stack is unavailable in this environment, skip execution and note it; the SQL is reviewed statically.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_categories_and_gifts.sql supabase/tests/0007_categories_test.sql
git commit -m "feat(db): add product category, purchase_category, is_gift, set_purchase_category"
```

---

## Task 2: Seed beverage products + tag existing products as flowers

**Files:**
- Modify: `supabase/seed.sql`
- Modify: `supabase/seed_dev.sql`

**Interfaces:**
- Produces: 5 beverage products (`category='beverage'`), each with one priced variant (`flower_count`/`foliage_level` null). Existing Table Tree / Box Bouquet rows carry `category='flower'` (the column default already yields this, but set it explicitly for clarity).

- [ ] **Step 1: Add beverage seed rows to `supabase/seed.sql`**

Append after the existing `variant_options` insert block:

```sql
-- Beverages (category 'beverage'; one priced variant each, no flower fields).
insert into products (id, name, slug, description, active, category) values
  ('33333333-0000-0000-0000-000000000001', 'Flat white', 'flat-white', null, true, 'beverage'),
  ('33333333-0000-0000-0000-000000000002', 'Latte',      'latte',      null, true, 'beverage'),
  ('33333333-0000-0000-0000-000000000003', 'Cappuccino', 'cappuccino', null, true, 'beverage'),
  ('33333333-0000-0000-0000-000000000004', 'Long black', 'long-black', null, true, 'beverage'),
  ('33333333-0000-0000-0000-000000000005', 'Tea',        'tea',        null, true, 'beverage');

insert into product_variants (id, product_id, size, flower_count, foliage_level, price_cents, active) values
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'std', null, null, 500, true),
  ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', 'std', null, null, 500, true),
  ('44444444-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', 'std', null, null, 500, true),
  ('44444444-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000004', 'std', null, null, 450, true),
  ('44444444-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000005', 'std', null, null, 400, true);
```

Also set `category` explicitly on the existing flower product insert (change the `products` insert column list + rows to include `category`):

```sql
insert into products (id, name, slug, description, active, category) values
  ('11111111-0000-0000-0000-000000000001', 'Table Tree', 'table-tree',
   'A single statement flower arranged in a coffee cup, with foliage that scales by size.', true, 'flower'),
  ('11111111-0000-0000-0000-000000000002', 'Living Room Box Bouquet', 'box-bouquet',
   'A larger box-format bouquet for living spaces.', true, 'flower');
```

- [ ] **Step 2: Mirror the beverage rows into `supabase/seed_dev.sql`**

Add the same two `insert` blocks (beverage products + variants) to `supabase/seed_dev.sql`. First inspect that file to match its existing product/variant IDs and style; append the beverage inserts using the same `33333333…`/`44444444…` IDs. If `seed_dev.sql` shares rows with `seed.sql` via `\i` or duplicate inserts, only add where products are actually defined (avoid duplicate-key inserts).

- [ ] **Step 3: Reset DB and verify beverages load**

Run: `supabase db reset`
Expected: no errors; then `supabase db query "select name, category from products order by category, name"` (or psql) shows 5 beverage + 2 flower rows. Skip if no local stack; review statically.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql supabase/seed_dev.sql
git commit -m "feat(db): seed beverage products and tag flower products with category"
```

---

## Task 3: `formatMoney` helper

**Files:**
- Modify: `frontend/src/money.ts`
- Modify: `frontend/src/money.test.ts`

**Interfaces:**
- Produces: `formatMoney(cents: number): string` → dollars with cents, e.g. `450 → "$4.50"`, `500 → "$5.00"`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/money.test.ts`:

```ts
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats whole and fractional dollars with two decimals', () => {
    expect(formatMoney(500)).toBe('$5.00');
    expect(formatMoney(450)).toBe('$4.50');
    expect(formatMoney(0)).toBe('$0.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- money`
Expected: FAIL — `formatMoney` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/money.ts`:

```ts
export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- money`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/money.ts frontend/src/money.test.ts
git commit -m "feat(money): add formatMoney for exact dollar+cents display"
```

---

## Task 4: Types + API surface for categories and gifts

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`

**Interfaces:**
- Consumes: Supabase `products.category`, `booking_items.is_gift`, RPC `set_purchase_category` (Task 1).
- Produces:
  - `Product.category: 'beverage' | 'flower'`
  - `BookingItem.isGift: boolean`
  - `getProductsByCategory(category: 'beverage' | 'flower'): Promise<Product[]>`
  - `setPurchaseCategory(category: 'beverage' | 'flower'): Promise<void>`
  - `addBookingItem(bookingId: string, variantId: string, options: Record<string,string>, quantity?: number, isGift?: boolean): Promise<BookingItem>` (new params default to `1, false`). **No price param** — the guard trigger (Task 10) snapshots the price server-side; the client inserts a `0` placeholder + `is_gift`.

- [ ] **Step 1: Update types**

In `frontend/src/types.ts`, add `category` to `Product` and `isGift` to `BookingItem`:

```ts
export interface Product {
  id: string; name: string; slug: string; description: string | null;
  category: 'beverage' | 'flower';
  variants: Variant[];
}
```

```ts
export interface BookingItem {
  id: string; bookingId: string; variantId: string;
  optionSnapshot: Record<string, string>;
  priceCentsSnapshot: number; quantity: number; isGift: boolean;
}
```

- [ ] **Step 2: Write the failing API test**

Add to `frontend/src/api.test.ts` (follow the existing `from`/`rpc` mock style already in that file):

```ts
import { getProductsByCategory, setPurchaseCategory } from './api';

describe('getProductsByCategory', () => {
  it('filters products by category', async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    from.mockReturnValue({ select });
    await getProductsByCategory('beverage');
    expect(eq1).toHaveBeenCalledWith('active', true);
    expect(eq2).toHaveBeenCalledWith('category', 'beverage');
  });
});

describe('setPurchaseCategory', () => {
  it('calls the RPC with the category', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setPurchaseCategory('flower');
    expect(rpc).toHaveBeenCalledWith('set_purchase_category', { p_category: 'flower' });
  });
});
```

(If `rpc` isn't already hoisted in `api.test.ts`, add it to the existing `vi.mock('./supabase', …)` mock next to `from`/`invoke`, matching how other RPC-backed functions are tested.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- api`
Expected: FAIL — `getProductsByCategory`/`setPurchaseCategory` not exported.

- [ ] **Step 4: Implement API changes**

In `frontend/src/api.ts`:

Add `category` to the products select and map it. Change the `getProducts` select string to include `category`:

```ts
export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,category,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map(mapProduct);
}

export async function getProductsByCategory(category: 'beverage' | 'flower'): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,category,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true)
    .eq('category', category);
  if (error) throw error;
  return (data ?? []).map(mapProduct);
}
```

Extract the existing product-mapping into a shared `mapProduct` (the body currently inline in `getProducts`), adding `category`:

```ts
function mapProduct(p: any): Product {
  return {
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    category: p.category,
    variants: (p.product_variants ?? []).map((v: any): Variant => ({
      id: v.id, productId: v.product_id, size: v.size,
      flowerCount: v.flower_count, foliageLevel: v.foliage_level, priceCents: v.price_cents,
      options: (v.variant_options ?? []).map((o: any) => ({ key: o.option_key, value: o.option_value })),
    })),
  };
}
```

Update `mapItem` to carry `is_gift`:

```ts
function mapItem(r: any): BookingItem {
  return { id: r.id, bookingId: r.booking_id, variantId: r.variant_id,
           optionSnapshot: r.option_snapshot ?? {}, priceCentsSnapshot: r.price_cents_snapshot,
           quantity: r.quantity, isGift: r.is_gift ?? false };
}
```

Update `addBookingItem` to accept the gift flag (no price — the trigger owns it):

```ts
export async function addBookingItem(bookingId: string, variantId: string,
    options: Record<string,string>, quantity = 1, isGift = false): Promise<BookingItem> {
  // price_cents_snapshot is a placeholder; guard_booking_item() (BEFORE INSERT)
  // overwrites it: 0 for gifts, the variant price (or 0 if unpriced) for paid items.
  const { data, error } = await supabase.from('booking_items')
    .insert({ booking_id: bookingId, variant_id: variantId, option_snapshot: options,
              quantity, price_cents_snapshot: 0, is_gift: isGift })
    .select().single();
  if (error) throw error;
  return mapItem(data);
}
```

Add `setPurchaseCategory`:

```ts
export async function setPurchaseCategory(category: 'beverage' | 'flower'): Promise<void> {
  const { error } = await supabase.rpc('set_purchase_category', { p_category: category });
  if (error) throw error;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- api`
Expected: PASS (new tests pass; existing `addBookingItem` test still passes since the extra params default).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(api): category-scoped products, setPurchaseCategory, gift-aware addBookingItem"
```

---

## Task 5: Gift-selection helpers (`gift.ts`)

**Files:**
- Create: `frontend/src/funnel/gift.ts`
- Create: `frontend/src/funnel/gift.test.ts`

**Interfaces:**
- Consumes: `Product`, `Variant` (types).
- Produces:
  - `flattenVariants(products: Product[]): { product: Product; variant: Variant }[]`
  - `variantLabel(product: Product, variant: Variant): string` — beverage → product name; flower → `"<name> — <SizeLabel>"`.
  - `cheapestVariant(variants: Variant[]): Variant | null` — lowest `priceCents` (null treated as +∞), tie-break `flowerCount` asc then size order `S,M,L,MD,LG`.
  - `freeEligibleIds(products: Product[], oppositeCategory: 'beverage' | 'flower'): Set<string>` — beverages: all variants tied at the minimum non-null price ("cheapest few"); flowers: exactly `cheapestVariant` of all flower variants (single).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/gift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cheapestVariant, freeEligibleIds, variantLabel } from './gift';
import type { Product, Variant } from '../types';

const v = (id: string, over: Partial<Variant> = {}): Variant => ({
  id, productId: 'p', size: 'std', flowerCount: null, foliageLevel: null,
  priceCents: null, options: [], ...over,
});

const bevProducts: Product[] = [
  { id: 'pf', name: 'Flat white', slug: 'fw', description: null, category: 'beverage',
    variants: [v('bf', { priceCents: 500 })] },
  { id: 'pt', name: 'Tea', slug: 'tea', description: null, category: 'beverage',
    variants: [v('bt', { priceCents: 400 })] },
  { id: 'pl', name: 'Long black', slug: 'lb', description: null, category: 'beverage',
    variants: [v('bl', { priceCents: 400 })] },
];

const flowerProducts: Product[] = [
  { id: 'tt', name: 'Table Tree', slug: 'table-tree', description: null, category: 'flower',
    variants: [v('s', { size: 'S', flowerCount: 1 }), v('m', { size: 'M', flowerCount: 1 }),
               v('l', { size: 'L', flowerCount: 1 })] },
];

describe('freeEligibleIds', () => {
  it('for beverages returns every variant tied at the cheapest price', () => {
    expect(freeEligibleIds(bevProducts, 'beverage')).toEqual(new Set(['bt', 'bl']));
  });
  it('for flowers returns exactly the single cheapest variant', () => {
    expect(freeEligibleIds(flowerProducts, 'flower')).toEqual(new Set(['s']));
  });
});

describe('cheapestVariant', () => {
  it('ranks null prices by flowerCount then size order', () => {
    expect(cheapestVariant(flowerProducts[0].variants)?.id).toBe('s');
  });
});

describe('variantLabel', () => {
  it('labels a beverage by product name only', () => {
    expect(variantLabel(bevProducts[0], bevProducts[0].variants[0])).toBe('Flat white');
  });
  it('labels a flower with its size', () => {
    expect(variantLabel(flowerProducts[0], flowerProducts[0].variants[0])).toBe('Table Tree — Small');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- gift`
Expected: FAIL — module `./gift` not found.

- [ ] **Step 3: Implement**

Create `frontend/src/funnel/gift.ts`:

```ts
import type { Product, Variant } from '../types';

const SIZE_ORDER = ['S', 'M', 'L', 'MD', 'LG'];
const SIZE_LABEL: Record<string, string> = { S: 'Small', M: 'Medium', L: 'Large', MD: 'Medium', LG: 'Large' };

export function flattenVariants(products: Product[]): { product: Product; variant: Variant }[] {
  return products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));
}

export function variantLabel(product: Product, variant: Variant): string {
  if (product.category === 'beverage') return product.name;
  const size = SIZE_LABEL[variant.size] ?? variant.size;
  return `${product.name} — ${size}`;
}

const sizeRank = (size: string) => {
  const i = SIZE_ORDER.indexOf(size);
  return i === -1 ? SIZE_ORDER.length : i;
};

export function cheapestVariant(variants: Variant[]): Variant | null {
  if (variants.length === 0) return null;
  return [...variants].sort((a, b) => {
    const pa = a.priceCents ?? Infinity;
    const pb = b.priceCents ?? Infinity;
    if (pa !== pb) return pa - pb;
    const fa = a.flowerCount ?? 0;
    const fb = b.flowerCount ?? 0;
    if (fa !== fb) return fa - fb;
    return sizeRank(a.size) - sizeRank(b.size);
  })[0];
}

export function freeEligibleIds(products: Product[], oppositeCategory: 'beverage' | 'flower'): Set<string> {
  const variants = flattenVariants(products).map((x) => x.variant);
  if (oppositeCategory === 'beverage') {
    const priced = variants.filter((v) => v.priceCents != null);
    if (priced.length === 0) return new Set();
    const min = Math.min(...priced.map((v) => v.priceCents as number));
    return new Set(priced.filter((v) => v.priceCents === min).map((v) => v.id));
  }
  const cheapest = cheapestVariant(variants);
  return cheapest ? new Set([cheapest.id]) : new Set();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- gift`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/gift.ts frontend/src/funnel/gift.test.ts
git commit -m "feat(funnel): gift-selection helpers (cheapest variant, free-eligible set, labels)"
```

---

## Task 6: `/choose` step + wire Landing to it

**Files:**
- Create: `frontend/src/funnel/Choose.tsx`
- Create: `frontend/src/funnel/Choose.test.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/funnel/Landing.tsx`
- Modify: `frontend/src/funnel/Landing.test.tsx`

**Interfaces:**
- Consumes: `setPurchaseCategory` (Task 4), `useFunnel` (`booking`).
- Produces: route `/choose` (gated); on select navigates to `/beverage` or `/flower`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Choose.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { setPurchaseCategory: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));
import Choose from './Choose';
beforeEach(() => { api.setPurchaseCategory.mockReset().mockResolvedValue(undefined); navigate.mockReset(); });
describe('Choose', () => {
  it('records the beverage category and advances to /beverage', async () => {
    render(<Choose />);
    fireEvent.click(screen.getByRole('button', { name: /a beverage/i }));
    await waitFor(() => expect(api.setPurchaseCategory).toHaveBeenCalledWith('beverage'));
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });
  it('records the flower category and advances to /flower', async () => {
    render(<Choose />);
    fireEvent.click(screen.getByRole('button', { name: /a flower/i }));
    await waitFor(() => expect(api.setPurchaseCategory).toHaveBeenCalledWith('flower'));
    expect(navigate).toHaveBeenCalledWith('/flower');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Choose`
Expected: FAIL — module `./Choose` not found.

- [ ] **Step 3: Implement `Choose.tsx`**

Create `frontend/src/funnel/Choose.tsx`:

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setPurchaseCategory } from '../api';
import { useFunnel } from './FunnelContext';

export default function Choose() {
  const navigate = useNavigate();
  const { booking } = useFunnel();

  useEffect(() => { if (!booking) navigate('/'); }, [booking, navigate]);

  async function pick(category: 'beverage' | 'flower') {
    await setPurchaseCategory(category);
    navigate(category === 'beverage' ? '/beverage' : '/flower');
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 2 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '33.333%' }} /></div>
        <h1>What are you here for?</h1>
        <p>Pick one to buy — the other comes free as a gift.</p>
      </header>
      <section className="funnel-card" aria-label="Choose a category">
        <div className="beverage-grid">
          <button className="beverage-option" onClick={() => pick('beverage')}>
            <span className="beverage-mark" aria-hidden="true">☕</span>
            <span>A beverage</span>
          </button>
          <button className="beverage-option" onClick={() => pick('flower')}>
            <span className="beverage-mark" aria-hidden="true">✿</span>
            <span>A flower</span>
          </button>
        </div>
      </section>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- Choose`
Expected: PASS.

- [ ] **Step 5: Wire the route and Landing nav**

In `frontend/src/main.tsx`, add the import and a gated route:

```tsx
import Choose from './funnel/Choose';
```

Inside the `FunnelGate` children array, add as the first entry:

```tsx
{ path: '/choose', element: <Choose /> },
```

In `frontend/src/funnel/Landing.tsx`, change the KosKup card handler from `/beverage` to `/choose`:

```tsx
<button type="button" className="koslist-card koslist-card--active" onClick={() => navigate('/choose')}>KosKup</button>
```

In `frontend/src/funnel/Landing.test.tsx`, update the KosKup assertion (currently `expect(navigate).toHaveBeenCalledWith('/beverage')` around line 75) to:

```tsx
expect(navigate).toHaveBeenCalledWith('/choose');
```

- [ ] **Step 6: Run the funnel tests**

Run: `npm test -- Landing Choose`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/funnel/Choose.tsx frontend/src/funnel/Choose.test.tsx frontend/src/main.tsx frontend/src/funnel/Landing.tsx frontend/src/funnel/Landing.test.tsx
git commit -m "feat(funnel): add /choose category step; KosKup routes to it"
```

---

## Task 7: Rework `/beverage` to priced product selection

**Files:**
- Modify: `frontend/src/funnel/Beverage.tsx`
- Modify: `frontend/src/funnel/Beverage.test.tsx`

**Interfaces:**
- Consumes: `getProductsByCategory('beverage')`, `getBookingItems`, `removeBookingItem`, `addBookingItem` (Task 4), `formatMoney` (Task 3), `useFunnel`.
- Produces: on continue, exactly one paid (`isGift=false`) `booking_item` for the chosen beverage variant, then navigate `/address`.

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/funnel/Beverage.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { getProductsByCategory: vi.fn(), getBookingItems: vi.fn(), removeBookingItem: vi.fn(), addBookingItem: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));
import Beverage from './Beverage';

const products = [
  { id: 'pl', name: 'Latte', slug: 'latte', description: null, category: 'beverage',
    variants: [{ id: 'vl', productId: 'pl', size: 'std', flowerCount: null, foliageLevel: null, priceCents: 500, options: [] }] },
  { id: 'pt', name: 'Tea', slug: 'tea', description: null, category: 'beverage',
    variants: [{ id: 'vt', productId: 'pt', size: 'std', flowerCount: null, foliageLevel: null, priceCents: 400, options: [] }] },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getProductsByCategory.mockResolvedValue(products);
  api.getBookingItems.mockResolvedValue([]);
  api.addBookingItem.mockResolvedValue({ id: 'i1', bookingId: 'bk-1', variantId: 'vl', optionSnapshot: {}, priceCentsSnapshot: 500, quantity: 1, isGift: false });
});

describe('Beverage', () => {
  it('shows prices, records the chosen beverage as a paid item, advances to /address', async () => {
    render(<Beverage />);
    fireEvent.click(await screen.findByRole('button', { name: /Latte/ }));
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('bk-1', 'vl', {}, 1, false));
    expect(navigate).toHaveBeenCalledWith('/address');
  });

  it('replaces a prior paid item before adding the new one', async () => {
    api.getBookingItems.mockResolvedValue([
      { id: 'old', bookingId: 'bk-1', variantId: 'vt', optionSnapshot: {}, priceCentsSnapshot: 400, quantity: 1, isGift: false },
      { id: 'gift', bookingId: 'bk-1', variantId: 'vx', optionSnapshot: {}, priceCentsSnapshot: 0, quantity: 1, isGift: true },
    ]);
    render(<Beverage />);
    fireEvent.click(await screen.findByRole('button', { name: /Latte/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(api.removeBookingItem).toHaveBeenCalledWith('old'));
    expect(api.removeBookingItem).not.toHaveBeenCalledWith('gift');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Beverage`
Expected: FAIL — component still uses `getConfigList`/`setBeverage`.

- [ ] **Step 3: Implement the reworked `Beverage.tsx`**

Replace `frontend/src/funnel/Beverage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { Product } from '../types';
import { formatMoney } from '../money';

export default function Beverage() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const [products, setProducts] = useState<Product[]>([]);
  const [choice, setChoice] = useState<string | null>(null); // variant id
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!booking) { navigate('/'); return; }
    let cancelled = false;
    import('../api').then(async (api) => {
      const list = await api.getProductsByCategory('beverage');
      if (!cancelled) setProducts(list);
    });
    return () => { cancelled = true; };
  }, [booking, navigate]);

  const flat = products.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v })));
  const chosen = flat.find((x) => x.variant.id === choice);

  async function onContinue() {
    if (saving || !booking) return;
    setSaving(true);
    const api = await import('../api');
    if (chosen) {
      const items = await api.getBookingItems(booking.id);
      await Promise.all(items.filter((i) => !i.isGift).map((i) => api.removeBookingItem(i.id)));
      await api.addBookingItem(booking.id, chosen.variant.id, {}, 1, false);
    }
    navigate('/address');
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 2 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '33.333%' }} /></div>
        <h1>What's your usual?</h1>
        <p>Choose your beverage.</p>
      </header>
      <section className="funnel-card beverage-card" aria-label="Choose a beverage">
        <div className="beverage-grid">
          {flat.map(({ product, variant }) => (
            <button key={variant.id} className="beverage-option" aria-pressed={choice === variant.id}
              onClick={() => setChoice(variant.id)}>
              <span className="beverage-mark" aria-hidden="true">{product.slug === 'tea' ? '✦' : '☕'}</span>
              <span>{product.name}</span>
              <span className="beverage-price">{formatMoney(variant.priceCents ?? 0)}</span>
            </button>
          ))}
        </div>
        <button className="add-btn funnel-action" onClick={onContinue} disabled={saving}>
          {chosen ? `Continue with ${chosen.product.name}` : 'Continue without choosing'}
        </button>
      </section>
    </div></div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- Beverage`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/funnel/Beverage.tsx frontend/src/funnel/Beverage.test.tsx
git commit -m "feat(funnel): beverage step selects a priced product and records a paid item"
```

---

## Task 8: `/flower` selection step (flower cart via ProductCard)

**Files:**
- Create: `frontend/src/funnel/Flower.tsx`
- Create: `frontend/src/funnel/Flower.test.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `getProductsByCategory('flower')`, `getBookingItems`, `addBookingItem`, `removeBookingItem` (Task 4); `ProductCard`, `ContinueBar` (existing components); `useFunnel`.
- Produces: route `/flower` (gated); paid `booking_item`s (`isGift=false`) for each added flower, then navigate `/address` on continue/skip.

**Why a cart, not single-select:** the flower category includes the Box Bouquet, whose variants require a `handle` option (with/without) — the `guard_booking_item()` trigger rejects a paid box insert with no valid handle. `ProductCard` already renders the size selector + handle toggle and emits the correct `options`, so the flower step reuses it (like the old FloralCollection) rather than reinventing option UI. Flowers are unpriced (`priceCents: null`) so `ProductCard` shows `$—` (display-only, honest). The step forces `purchaseEnabled: true` locally (the retired `floral_purchase_enabled` flag no longer gates purchases — see Task 10), so Add buttons are live.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/funnel/Flower.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { getProductsByCategory: vi.fn(), getBookingItems: vi.fn(), addBookingItem: vi.fn(), removeBookingItem: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));
import Flower from './Flower';

const products = [
  { id: 'tt', name: 'Table Tree', slug: 'table-tree', description: null, category: 'flower',
    variants: [
      { id: 's', productId: 'tt', size: 'S', flowerCount: 1, foliageLevel: 'slight', priceCents: null, options: [] },
      { id: 'm', productId: 'tt', size: 'M', flowerCount: 1, foliageLevel: 'some', priceCents: null, options: [] },
      { id: 'l', productId: 'tt', size: 'L', flowerCount: 1, foliageLevel: 'lots', priceCents: null, options: [] },
    ] },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getProductsByCategory.mockResolvedValue(products);
  api.getBookingItems.mockResolvedValue([]);
  api.addBookingItem.mockResolvedValue({ id: 'i1', bookingId: 'bk-1', variantId: 's', optionSnapshot: {}, priceCentsSnapshot: 0, quantity: 1, isGift: false });
});

describe('Flower', () => {
  it('adds the selected flower as a paid item, then advances to /address', async () => {
    render(<Flower />);
    // ProductCard's default size is the first variant (S); its Add button reads "Schedule Delivery".
    const addBtn = await screen.findByRole('button', { name: /schedule delivery/i });
    fireEvent.click(addBtn);
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('bk-1', 's', {}, 1, false));
    // Continue bar (count now 1) → /address.
    fireEvent.click(screen.getByRole('button', { name: /^continue/i }));
    expect(navigate).toHaveBeenCalledWith('/address');
  });

  it('skips to /address when nothing is added', async () => {
    render(<Flower />);
    fireEvent.click(await screen.findByRole('button', { name: /no thanks, continue/i }));
    expect(navigate).toHaveBeenCalledWith('/address');
    expect(api.addBookingItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Flower`
Expected: FAIL — module `./Flower` not found.

- [ ] **Step 3: Implement `Flower.tsx`**

Create `frontend/src/funnel/Flower.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { AppConfig, BookingItem, Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { ContinueBar } from '../components/ContinueBar';

// The flower step is a live purchase page: force purchaseEnabled so ProductCard's
// Add buttons are active regardless of the (retired) floral_purchase_enabled flag.
// Flowers are unpriced, so pricingMode is irrelevant here (ProductCard shows $—).
const PURCHASE_CONFIG: AppConfig = { purchaseEnabled: true, pricingMode: 'placeholder' };

export default function Flower() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<BookingItem[]>([]);

  useEffect(() => {
    if (!booking) { navigate('/'); return; }
    let cancelled = false;
    import('../api').then(async (api) => {
      const [prods, its] = await Promise.all([
        api.getProductsByCategory('flower'),
        api.getBookingItems(booking.id),
      ]);
      if (cancelled) return;
      setProducts(prods);
      setItems(its.filter((i) => !i.isGift));
    });
    return () => { cancelled = true; };
  }, [booking, navigate]);

  async function handleAdd(variantId: string, options: Record<string, string>): Promise<BookingItem> {
    const api = await import('../api');
    const item = await api.addBookingItem(booking!.id, variantId, options, 1, false);
    setItems((prev) => [...prev, item]);
    return item;
  }
  async function handleRemove(itemId: string): Promise<void> {
    const api = await import('../api');
    await api.removeBookingItem(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  const goToAddress = () => navigate('/address');
  if (!booking) return null;

  return (
    <>
      <div className="grain" />
      <div className="screen"><div className="wrap">
        <header className="head">
          <p className="eyebrow">Step 2 of 6</p>
          <h1>Pick your flowers</h1>
          <p>Choose an arrangement — add as many as you like.</p>
        </header>
        <div className="grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} config={PURCHASE_CONFIG}
              onAdd={handleAdd} onRemove={handleRemove} />
          ))}
        </div>
      </div></div>
      <ContinueBar count={items.length} onSkip={goToAddress} onContinue={goToAddress} />
    </>
  );
}
```

- [ ] **Step 4: Add the gated route**

In `frontend/src/main.tsx`:

```tsx
import Flower from './funnel/Flower';
```

Add to the `FunnelGate` children (near `/beverage`):

```tsx
{ path: '/flower', element: <Flower /> },
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- Flower`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/funnel/Flower.tsx frontend/src/funnel/Flower.test.tsx frontend/src/main.tsx
git commit -m "feat(funnel): add /flower flower-cart selection step (reuses ProductCard)"
```

---

## Task 9: Category-driven `/bonus` page + final routing

**Files:**
- Create: `frontend/src/pages/Bonus.tsx`
- Create: `frontend/src/pages/Bonus.test.tsx`
- Delete: `frontend/src/pages/FloralCollection.tsx`, `frontend/src/pages/FloralCollection.test.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/funnel/Card.tsx`

**Interfaces:**
- Consumes: `getMyBooking` (returns `Booking`), `getMyDraftBooking`/`purchase_category`, `getProductsByCategory`, `getBookingItems`, `addBookingItem`, `removeBookingItem` (Task 4); `freeEligibleIds`, `variantLabel`, `flattenVariants` (Task 5); `ContinueBar`.
- Produces: route `/bonus`; redirect `/bonus-flowers` → `/bonus`; `Card` navigates to `/bonus`.

**Booking category source:** `getMyBooking()` maps `bookings` but `Booking` doesn't carry `purchase_category`. Add `purchaseCategory` to the `Booking` type and `mapBooking` so the bonus page can read it.

- [ ] **Step 1: Extend `Booking` with `purchaseCategory`**

In `frontend/src/types.ts`, add to `Booking`:

```ts
export interface Booking {
  id: string; customerName: string | null; email: string | null;
  slotAt: string | null; coffeePriceCents: number | null;
  redemptionToken: string; status: string;
  purchaseCategory: 'beverage' | 'flower' | null;
}
```

In `frontend/src/api.ts` `mapBooking`, add:

```ts
purchaseCategory: b.purchase_category ?? null,
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/Bonus.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { getMyBooking: vi.fn(), getProductsByCategory: vi.fn(), getBookingItems: vi.fn(),
              addBookingItem: vi.fn(), removeBookingItem: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import Bonus from './Bonus';

const flowers = [{ id: 'tt', name: 'Table Tree', slug: 'table-tree', description: null, category: 'flower',
  variants: [
    { id: 's', productId: 'tt', size: 'S', flowerCount: 1, foliageLevel: 'slight', priceCents: null, options: [] },
    { id: 'l', productId: 'tt', size: 'L', flowerCount: 1, foliageLevel: 'lots', priceCents: null, options: [] },
  ] }];
const beverages = [
  { id: 'pl', name: 'Latte', slug: 'latte', description: null, category: 'beverage',
    variants: [{ id: 'vl', productId: 'pl', size: 'std', flowerCount: null, foliageLevel: null, priceCents: 500, options: [] }] },
  { id: 'pt', name: 'Tea', slug: 'tea', description: null, category: 'beverage',
    variants: [{ id: 'vt', productId: 'pt', size: 'std', flowerCount: null, foliageLevel: null, priceCents: 400, options: [] }] },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getBookingItems.mockResolvedValue([]);
  api.addBookingItem.mockResolvedValue({ id: 'g1', bookingId: 'b1', variantId: 's', optionSnapshot: {}, priceCentsSnapshot: 0, quantity: 1, isGift: true });
});

describe('Bonus — beverage buyer sees flowers, cheapest is the free gift', () => {
  beforeEach(() => {
    api.getMyBooking.mockResolvedValue({ id: 'b1', purchaseCategory: 'beverage', status: 'pending', redemptionToken: 't', coffeePriceCents: null, customerName: null, email: null, slotAt: null });
    api.getProductsByCategory.mockResolvedValue(flowers);
  });
  it('adds the single cheapest flower as a free gift', async () => {
    render(<Bonus />);
    const giftBtn = await screen.findByRole('button', { name: /add free gift — Table Tree — Small/i });
    // The larger size is shown but not free-selectable.
    expect(screen.queryByRole('button', { name: /add free gift — Table Tree — Large/i })).toBeNull();
    fireEvent.click(giftBtn);
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('b1', 's', {}, 1, true));
    expect(screen.queryByText(/\$/)).toBeNull(); // no prices shown
  });
});

describe('Bonus — flower buyer picks one of the cheapest beverages', () => {
  beforeEach(() => {
    api.getMyBooking.mockResolvedValue({ id: 'b1', purchaseCategory: 'flower', status: 'pending', redemptionToken: 't', coffeePriceCents: null, customerName: null, email: null, slotAt: null });
    api.getProductsByCategory.mockResolvedValue(beverages);
  });
  it('offers the cheapest beverage(s) free and adds the chosen one', async () => {
    render(<Bonus />);
    const teaBtn = await screen.findByRole('button', { name: /add free gift — Tea/i }); // 400 = cheapest
    expect(screen.queryByRole('button', { name: /add free gift — Latte/i })).toBeNull(); // 500 not eligible
    fireEvent.click(teaBtn);
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('b1', 'vt', {}, 1, true));
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- Bonus`
Expected: FAIL — module `./Bonus` not found.

- [ ] **Step 4: Implement `Bonus.tsx`**

Create `frontend/src/pages/Bonus.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Booking, Product } from '../types';
import { ContinueBar } from '../components/ContinueBar';
import { flattenVariants, freeEligibleIds, variantLabel } from '../funnel/gift';

function loadApi() { return import('../api'); }

export default function Bonus() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [giftItemId, setGiftItemId] = useState<string | null>(null);

  // Beverage buyers get a flower gift; flower buyers get a beverage gift. Legacy
  // bookings with no category default to the flower-gift path (original behaviour).
  const opposite: 'beverage' | 'flower' =
    booking?.purchaseCategory === 'flower' ? 'beverage' : 'flower';

  useEffect(() => {
    let cancelled = false;
    loadApi().then(async (api) => {
      const bk = await api.getMyBooking();
      if (cancelled || !bk) return;
      setBooking(bk);
      const opp: 'beverage' | 'flower' = bk.purchaseCategory === 'flower' ? 'beverage' : 'flower';
      const prods = await api.getProductsByCategory(opp);
      if (cancelled) return;
      setProducts(prods);
    });
    return () => { cancelled = true; };
  }, []);

  const eligible = freeEligibleIds(products, opposite);
  const rows = flattenVariants(products);

  async function addGift(variantId: string) {
    if (!booking) return;
    const api = await loadApi();
    const items = await api.getBookingItems(booking.id);
    await Promise.all(items.filter((i) => i.isGift).map((i) => api.removeBookingItem(i.id)));
    const item = await api.addBookingItem(booking.id, variantId, {}, 1, true);
    setGiftItemId(item.id);
  }

  const goToConfirmation = () => navigate('/confirmation');
  if (!booking) return null;

  const heading = opposite === 'flower'
    ? 'Add a flower to your order — on us'
    : 'Add a coffee to your order — on us';

  return (
    <>
      <div className="grain" />
      <div className="screen"><div className="wrap">
        <header className="head">
          <p className="eyebrow">A little something extra</p>
          <h1>{heading}</h1>
          <p>Our gift with your order — pick one, totally free.</p>
        </header>
        <div className="grid">
          {rows.map(({ product, variant }) => {
            const isEligible = eligible.has(variant.id);
            return (
              <div key={variant.id} className="gift-option">
                <span>{variantLabel(product, variant)}</span>
                {isEligible ? (
                  <button className="add-btn" onClick={() => addGift(variant.id)}>
                    {giftItemId ? 'Added' : `Add free gift — ${variantLabel(product, variant)}`}
                  </button>
                ) : (
                  <span className="gift-ineligible">Not part of the free gift</span>
                )}
              </div>
            );
          })}
        </div>
      </div></div>
      <ContinueBar count={giftItemId ? 1 : 0} onSkip={goToConfirmation} onContinue={goToConfirmation} />
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- Bonus`
Expected: PASS (both describe blocks).

- [ ] **Step 6: Wire routing, Card nav, delete the old page**

In `frontend/src/main.tsx`:
- Replace the `FloralCollection` import with `import Bonus from './pages/Bonus';`.
- Replace the route `{ path: '/bonus-flowers', element: <FloralCollection /> }` with two routes:

```tsx
{ path: '/bonus', element: <Bonus /> },
{ path: '/bonus-flowers', element: <Navigate to="/bonus" replace /> },
```

Add `Navigate` to the react-router-dom import:

```tsx
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
```

In `frontend/src/funnel/Card.tsx`, change the post-save navigation:

```tsx
navigate('/bonus');
```

Delete the old page and its test:

```bash
git rm frontend/src/pages/FloralCollection.tsx frontend/src/pages/FloralCollection.test.tsx
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm test`
Expected: PASS across all files (no lingering references to `FloralCollection`, `getConfigList` beverage usage, or `setBeverage` in the funnel).

- [ ] **Step 8: Build to confirm types**

Run: `npm run build`
Expected: `tsc -b` clean, Vite build succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(bonus): category-driven /bonus free-gift page; retire FloralCollection route"
```

---

## Task 10: Rewrite `guard_booking_item()` for gifts + beverages/unpriced flowers

> **Execute this task early — right after Task 1** — because Tasks 4/7/8/9 depend on its price/gift semantics. (Frontend unit tests mock the API and pass regardless, but the live flow is broken without it.)

**Files:**
- Create: `supabase/migrations/0011_booking_item_gift_guard.sql`

**Interfaces:**
- Produces: a reworked `guard_booking_item()` BEFORE-INSERT trigger function. Gifts (`is_gift=true`) always snapshot `price_cents_snapshot = 0`, force empty options, and bypass the purchase/pricing gates. Paid items validate options (handle for box variants) and snapshot `coalesce(variant.price_cents, 0)`. The old `floral_purchase_enabled` hard-block is removed.

**Why:** The original `guard_booking_item()` (migrations `0003`/`0004`) hard-blocks every insert unless `floral_purchase_enabled` is true (seeded false), rejects unpriced variants (`variant_unpriced`), and force-snapshots the variant price — none of which fit the new model where beverages and flowers are both purchasable, gifts must be free, and flowers are as-yet unpriced. `create or replace function` rebinds the existing `trg_guard_booking_item` trigger automatically; no trigger recreation needed.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_booking_item_gift_guard.sql`:

```sql
-- Rework the booking_items guard for the beverage/flower + free-gift model.
-- Beverages and flowers are both purchasable products now, and a booking_item may be
-- a paid item or a free gift (is_gift). The prior guard hard-blocked all inserts behind
-- floral_purchase_enabled, rejected unpriced variants, and force-snapshotted the variant
-- price — none of which fit gifts (must be $0) or as-yet-unpriced flowers.

create or replace function guard_booking_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_handle text;
begin
  select price_cents, active into v from product_variants where id = new.variant_id;
  if v is null or not v.active then
    raise exception 'variant_inactive';
  end if;

  -- Free gifts: always $0, no options, exempt from purchase/pricing gates.
  if new.is_gift then
    new.price_cents_snapshot := 0;
    new.option_snapshot := '{}'::jsonb;
    return new;
  end if;

  -- Paid items: validate options (only variants that define options may carry one).
  if exists (select 1 from variant_options o where o.variant_id = new.variant_id) then
    v_handle := new.option_snapshot->>'handle';
    if v_handle is null or not exists (
      select 1 from variant_options o
      where o.variant_id = new.variant_id and o.option_key = 'handle' and o.option_value = v_handle
    ) then
      raise exception 'invalid_option';
    end if;
    new.option_snapshot := jsonb_build_object('handle', v_handle);
  else
    new.option_snapshot := '{}'::jsonb;
  end if;

  -- Server-side price snapshot; unpriced variants (e.g. flowers pending pricing)
  -- snapshot to $0 since in-funnel payment is display-only.
  new.price_cents_snapshot := coalesce(v.price_cents, 0);
  return new;
end;
$$;
```

- [ ] **Step 2: Apply locally and sanity-check (if the stack is available)**

Run: `supabase db reset`
Expected: no errors. Then, if the local stack is available, verify a gift insert snapshots $0 and a paid beverage snapshots its price (e.g. via `supabase db query` inserting under a draft booking). If Docker/Supabase local is unavailable, skip and note it — the SQL is reviewed statically.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_booking_item_gift_guard.sql
git commit -m "feat(db): rework guard_booking_item for free gifts + beverage/flower purchases"
```

---

## Self-Review

**Spec coverage**
- New `/choose` step in Step-2 slot → Task 6. ✓
- Beverages as priced `products` with category → Tasks 1, 2, 4, 7. ✓
- Flower purchase step (all flower products, incl. box handle option) → Task 8 (reuses `ProductCard` cart). ✓
- `bookings.purchase_category` + RPC → Tasks 1, 4, 6. ✓
- `booking_items.is_gift` + $0 gift → Tasks 1, 4, 9, **10** (the guard trigger snapshots $0 for gifts); `deliver-booking` already sums snapshots so gift = $0 with no change. ✓
- Server-side price integrity + gift-free + unpriced-flower support → Task 10 (guard trigger rewrite). ✓
- `/bonus` renamed, category-driven, opposite category price-free, cheapest-tier free gift (single flower / one-of-cheapest-few beverages) → Tasks 5, 9. ✓
- Nullable flower columns for beverages → Task 1. ✓
- Payment display-only; one beverage (replace) / flower cart / one gift; step labels → enforced in Tasks 6–10 and Global Constraints. ✓
- Legacy `bookings.beverage` / `set_booking_beverage` / `beverage_options` left in place, unreferenced by funnel → beverage step no longer calls them (Task 7); nothing drops them. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" left; every code step shows full code. ✓

**Type consistency:** `getProductsByCategory`, `setPurchaseCategory`, `addBookingItem(bookingId, variantId, options, quantity?, isGift?)` (no client price param), `Product.category`, `BookingItem.isGift`, `Booking.purchaseCategory`, and `gift.ts` exports (`freeEligibleIds`, `variantLabel`, `flattenVariants`, `cheapestVariant`) are defined in Tasks 4/5 and consumed with matching signatures in Tasks 6–9. ✓

**Execution order:** 1 → **10** → 3 → 4 → 5 → 6 → 7 → 8 → 9. Task 10 runs right after Task 1 (both DB); the rest follow the numbered order.

**Note for implementer:** Task 7 (beverage, single-select grid) and Task 8 (flower, ProductCard cart) now differ in shape — no shared-component extraction is expected. `ProductCard`/`SizeSelector`/`HandleToggle` remain used (by the flower step); only `FloralCollection` is deleted in Task 9.
