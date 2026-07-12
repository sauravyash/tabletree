import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = { getMyBooking: vi.fn(), getBookingItems: vi.fn(), getProducts: vi.fn() };
vi.mock('../api', () => api);

import Confirmation from './Confirmation';

function renderConfirmation() {
  return render(<MemoryRouter><Confirmation /></MemoryRouter>);
}

beforeEach(() => {
  api.getMyBooking.mockResolvedValue({ id: 'b1', redemptionToken: 'demo-redeem-01', status: 'pending',
    coffeePriceCents: 500, customerName: 'Demo', email: null, slotAt: null });
  api.getBookingItems.mockResolvedValue([]);
  api.getProducts.mockResolvedValue([]);
});

describe('Confirmation', () => {
  it('shows the free-tabletree redemption token', async () => {
    renderConfirmation();
    expect(await screen.findByText(/demo-redeem-01/)).toBeInTheDocument();
  });
  it('lists added floral line items with size and handle', async () => {
    api.getBookingItems.mockResolvedValue([
      { id: 'i1', bookingId: 'b1', variantId: 'v-md', optionSnapshot: { handle: 'with' }, priceCentsSnapshot: 6500, quantity: 1 },
    ]);
    api.getProducts.mockResolvedValue([
      { id: 'p2', name: 'Living Room Box Bouquet', slug: 'box', description: null,
        variants: [{ id: 'v-md', productId: 'p2', size: 'MD', flowerCount: 3, foliageLevel: 'appropriate', priceCents: 6500, options: [] }] },
    ]);
    renderConfirmation();
    expect(await screen.findByText(/Living Room Box Bouquet/)).toBeInTheDocument();
    expect(screen.getByText(/handle: with/i)).toBeInTheDocument();
  });
  it('returns to the main page', async () => {
    function Location() {
      return <output>{useLocation().pathname}</output>;
    }
    render(<MemoryRouter initialEntries={['/confirmation']}><Confirmation /><Location /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /return to home/i }));
    expect(screen.getByText('/')).toBeInTheDocument();
  });
});
