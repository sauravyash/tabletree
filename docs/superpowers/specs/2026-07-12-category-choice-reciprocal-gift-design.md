# Category choice + reciprocal free-gift bonus — design

**Date:** 2026-07-12
**Status:** Approved, ready for planning

## Problem

Today the KosKup funnel is beverage-only: the KosKup card jumps straight to a
beverage step where the drink is a free-text option with no price, stored on
`bookings.beverage`. Flowers appear only afterwards on the `/bonus-flowers`
upsell page (`FloralCollection`), priced via `products` / `product_variants` and
added as `booking_items`.

We want the customer to choose **up front** whether they are here for a
**beverage** or a **flower**, buy one priced item from that category, and then be
offered a single **free gift** from the *opposite* category on the bonus page.

## Desired flow

```
Landing (KosList / KosKup card)              — Step 1 (implicit)
  └─ KosKup → /choose                        — Step 2: pick "A beverage" or "A flower"
       ├─ beverage → /beverage               — Step 2: priced beverage list, pick one (paid)
       └─ flower   → /flower                 — Step 2: priced flower list, pick one (paid)
  → /address                                 — Step 3   (unchanged)
  → /slot                                    — Step 4   (unchanged)
  → /account                                 — Step 5   (unchanged)
  → /card                                    — Step 6   (unchanged)
  → /bonus                                   — reciprocal free-gift page
  → /confirmation
```

The new `/choose` step and the two selection pages all sit in the **"Step 2 of 6"**
slot, so the visible step numbering is unchanged (Address stays Step 3, Card stays
Step 6).

`/bonus` (renamed from `/bonus-flowers`) is fully **category-driven**: it reads
`bookings.purchase_category` and shows the **opposite** category with **prices
removed**, offering exactly one free gift.

### Free-gift rule (settled)

- Exactly **one** free gift per booking.
- Beverage-buyer → opposite category is **flowers**; the free gift is the **single
  cheapest flower** variant.
- Flower-buyer → opposite category is **beverages**; the few cheapest beverages are
  shown as the free-eligible set and the user **picks one** of them.
- Only the cheapest-tier item(s) are selectable; pricier opposite-category items are
  shown (price-free) but not free-selectable.

### Payment scope (settled)

**Display-only.** Prices are shown for the paid item, but the payment model is
unchanged: a card is saved via the existing Stripe setup-intent during the funnel
and charged later off-platform. No new charge/total/tax logic in this work.

## Data model changes (Supabase)

New migration (next number after `0009_booking_wish.sql`).

1. **`products.category`** — `text not null default 'flower'`, constrained to
   `('beverage','flower')`. Existing rows (Table Tree, Box Bouquet) default to
   `'flower'`. Beverages inserted as `'beverage'`.
2. **`product_variants.flower_count` / `foliage_level`** — relax to **nullable**
   (`drop not null`). Beverages carry neither.
3. **`bookings.purchase_category`** — `text` nullable, constrained to
   `('beverage','flower')`. Set at `/choose`.
4. **`booking_items.is_gift`** — `boolean not null default false`. Paid item:
   `is_gift = false`, `price_cents_snapshot` = the chosen variant's price. Free
   gift: `is_gift = true`, `price_cents_snapshot = 0`.
5. **RPC `set_purchase_category(p_category text)`** — updates the caller's draft
   booking's `purchase_category` (mirrors `set_booking_beverage`'s shape; same
   `authenticated` grant + draft/`auth.uid()` guard).

Seed (`seed.sql` / `seed_dev.sql` as appropriate): beverage products, one product
per drink with a single priced variant. Placeholder AUD prices, e.g. Flat white
$5.00, Latte $5.00, Cappuccino $5.00, Long black $4.50, Tea $4.00
(`flower_count`/`foliage_level` null).

**Left in place but no longer used by the funnel:** `bookings.beverage` column,
`set_booking_beverage` RPC, and the `beverage_options` app_config row. Not dropped
(avoids touching staff/delivery assumptions); simply unreferenced by the new funnel.

### Price snapshot integrity

`addBookingItem` currently hard-codes `price_cents_snapshot: 0` and inserts directly
under RLS (client-trusted). Because payment is display-only, we keep this trust
model but pass the **real** price for paid items and `0` for gifts, rather than
introducing a server-side snapshot RPC in this pass. (Noted as a possible later
hardening, out of scope here.)

## Frontend changes

### Routing (`main.tsx`)
- Add gated routes `/choose` and `/flower` (inside `FunnelGate`).
- Rename `/bonus-flowers` → `/bonus`; add a redirect from `/bonus-flowers` → `/bonus`
  for any stale links.
- KosKup card in `Landing.tsx` navigates to `/choose` (was `/beverage`).
- `Card.tsx` navigates to `/bonus` (was `/bonus-flowers`).

### New `Choose.tsx` (Step 2)
Two large choice cards, "A beverage" and "A flower". On select: call
`setPurchaseCategory(cat)`, refresh funnel, navigate to `/beverage` or `/flower`.
Requires a booking (redirect to `/` if none), matching the other steps.

### Generalize `Beverage.tsx` (Step 2)
- Replace `getConfigList('beverage_options')` with priced beverage products via
  `getProductsByCategory('beverage')`.
- Render each beverage (name + `formatPrice(price)`), single-select. Continue adds
  the chosen variant as a **paid** `booking_item` (`isGift=false`, real price), then
  navigates to `/address`.
- Re-selecting replaces the prior paid item (remove old, add new) so there is only
  ever one paid item.

### New `Flower.tsx` (Step 2)
- Priced flower selection via `getProductsByCategory('flower')`, reusing
  `ProductCard` for the flower UI (size/foliage/handle) **with prices shown**.
- Selecting adds the chosen variant as the paid `booking_item`, then `/address`.
- Single paid item enforced as above.

### Generalize the bonus page (`FloralCollection` → the `/bonus` page)
- Load `booking.purchase_category`; compute `oppositeCategory`.
- Fetch products of `oppositeCategory`; **hide prices**.
- Determine the cheapest-tier free-eligible variant(s); allow adding exactly one as
  a gift (`isGift=true`, price 0). Non-cheapest items render price-free but are not
  free-selectable.
- Copy adapts to category (flowers vs beverages). Fallback: if `purchase_category`
  is null (legacy booking), default to showing flowers (current behaviour).
- Continue/skip → `/confirmation` (unchanged `ContinueBar`).

### API (`api.ts`) + types
- `getProductsByCategory(category: 'beverage' | 'flower'): Promise<Product[]>` —
  `getProducts()` filtered by `category` (add `category` to the select + `.eq`).
- `setPurchaseCategory(category): Promise<void>` — calls the new RPC.
- Extend `addBookingItem(bookingId, variantId, options, quantity, priceCents,
  isGift)` — inserts `price_cents_snapshot: priceCents` and `is_gift: isGift`.
- Types: add `category: 'beverage' | 'flower'` to `Product`; add `isGift: boolean`
  to `BookingItem`; map the new columns in `getProducts`/`mapItem`.

## Testing

- Co-located `*.test.tsx` for `Choose`, `Flower`, generalized `Beverage`, and the
  category-driven `/bonus` page (beverage-path shows flowers/gift = cheapest flower;
  flower-path shows beverages/gift = one of cheapest few).
- Supabase test under `supabase/tests` for the new columns, constraints, and
  `set_purchase_category` RPC.
- `deliver-booking` charge math needs no change — gift rows carry
  `price_cents_snapshot = 0`, already summed by `computeCharge`; add/confirm a case
  asserting a gift item contributes $0.

## Out of scope

- Actually charging the displayed price (payment stays display-only).
- Server-side price-snapshot hardening for `booking_items`.
- Removing the legacy `bookings.beverage` column / `set_booking_beverage` RPC /
  `beverage_options` config.
- Multiple paid items or multiple gifts per booking.
