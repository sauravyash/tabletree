import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = { getBooking: vi.fn(), getBookingItems: vi.fn(), getProducts: vi.fn() };
vi.mock('../api', () => api);

import Confirmation from './Confirmation';

beforeEach(() => {
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 'demo-redeem-01', status: 'pending',
    coffeePriceCents: 500, customerName: 'Demo', email: null, slotAt: null });
  api.getBookingItems.mockResolvedValue([]);
  api.getProducts.mockResolvedValue([]);
});

describe('Confirmation', () => {
  it('shows the free-tabletree redemption token', async () => {
    render(<Confirmation />);
    expect(await screen.findByText(/demo-redeem-01/)).toBeInTheDocument();
  });
});
