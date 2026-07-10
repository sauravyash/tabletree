import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = { getBooking: vi.fn(), getBookingItems: vi.fn(), getProducts: vi.fn(), deliverBooking: vi.fn() };
vi.mock('../api', () => api);

import StaffBooking from './StaffBooking';

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: 'Demo', email: null, slotAt: null });
  api.getProducts.mockResolvedValue([{ id: 'p2', name: 'Living Room Box Bouquet', slug: 'box', description: null,
    variants: [{ id: 'v-md', productId: 'p2', size: 'MD', flowerCount: 3, foliageLevel: 'appropriate', priceCents: 6500, options: [] }] }]);
  api.getBookingItems.mockResolvedValue([{ id: 'i1', bookingId: 'b1', variantId: 'v-md', optionSnapshot: { handle: 'with' }, priceCentsSnapshot: 6500, quantity: 1 }]);
});

describe('StaffBooking', () => {
  it('lists floral line items with size and handle', async () => {
    render(<StaffBooking />);
    expect(await screen.findByText(/Living Room Box Bouquet/)).toBeInTheDocument();
    expect(screen.getByText(/handle: with/i)).toBeInTheDocument();
  });
  it('marks delivered via the edge function', async () => {
    api.deliverBooking.mockResolvedValue({ status: 'delivered' });
    render(<StaffBooking />);
    const btn = await screen.findByRole('button', { name: /mark delivered/i });
    fireEvent.click(btn);
    await waitFor(() => expect(api.deliverBooking).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText(/delivered/i)).toBeInTheDocument();
  });
});
