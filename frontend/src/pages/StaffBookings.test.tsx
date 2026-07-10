import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = { listPendingBookings: vi.fn() };
vi.mock('../api', () => api);

import StaffBookings from './StaffBookings';

beforeEach(() => {
  api.listPendingBookings.mockReset();
  api.listPendingBookings.mockResolvedValue([
    { id: 'b2xxxxxx', customerName: 'Alice', email: null, slotAt: null, coffeePriceCents: 650, redemptionToken: 't', status: 'pending' },
    { id: 'b3xxxxxx', customerName: 'Bob', email: null, slotAt: null, coffeePriceCents: 750, redemptionToken: 't', status: 'pending' },
  ]);
});

describe('StaffBookings', () => {
  it('lists pending bookings as links to detail', async () => {
    render(<MemoryRouter><StaffBookings /></MemoryRouter>);
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    const link = screen.getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', '/staff/b2xxxxxx');
  });
});
