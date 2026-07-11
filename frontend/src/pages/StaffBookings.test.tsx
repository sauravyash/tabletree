import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = { listPendingBookings: vi.fn() };
vi.mock('../api', () => api);

const { auth, from } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    signInWithPassword: vi.fn(),
  },
  from: vi.fn(),
}));
vi.mock('../supabase', () => ({ supabase: { auth, from } }));

import StaffBookings from './StaffBookings';

beforeEach(() => {
  api.listPendingBookings.mockReset();
  api.listPendingBookings.mockResolvedValue([
    { id: 'b2xxxxxx', customerName: 'Alice', email: null, slotAt: null, coffeePriceCents: 650, redemptionToken: 't', status: 'pending' },
    { id: 'b3xxxxxx', customerName: 'Bob', email: null, slotAt: null, coffeePriceCents: 750, redemptionToken: 't', status: 'pending' },
  ]);
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signInWithPassword.mockReset();
  from.mockReset();
});

describe('StaffBookings', () => {
  it('shows a staff sign-in form when the session is not staff', async () => {
    render(<MemoryRouter><StaffBookings /></MemoryRouter>);
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('lists pending bookings as links to detail', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u-f1' } } },
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { role: 'staff' } }),
          }),
        }),
      }),
    });

    render(<MemoryRouter><StaffBookings /></MemoryRouter>);
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    const link = screen.getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', '/staff/b2xxxxxx');
  });
});
