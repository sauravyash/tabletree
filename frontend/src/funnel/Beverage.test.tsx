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
