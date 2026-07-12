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
