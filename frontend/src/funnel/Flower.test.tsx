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
