import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listPendingBookings: vi.fn(),
  getProducts: vi.fn(),
  getBookingItems: vi.fn(),
  deliverBooking: vi.fn(),
}));
vi.mock('../api', () => api);

const { auth, from } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
  },
  from: vi.fn(),
}));
vi.mock('../supabase', () => ({ supabase: { auth, from } }));

import StaffBooking from './StaffBooking';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listPendingBookings.mockResolvedValue([
    {
      id: 'b1',
      customerName: 'Alice Example',
      email: 'alice@tabletree.test',
      slotAt: '2026-07-11T12:00:00.000Z',
      coffeePriceCents: 650,
      redemptionToken: 'a',
      status: 'pending',
    },
  ]);
  api.getProducts.mockResolvedValue([{ id: 'p1', name: 'Table Tree', slug: 'table-tree', description: null, variants: [] }]);
  api.getBookingItems.mockResolvedValue([]);
  api.deliverBooking.mockResolvedValue({ status: 'delivered' });
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue({
    data: {
      session: {
        user: {
          id: 'u-f1',
          email: 'staff@tabletree.test',
          user_metadata: {},
        },
      },
    },
  });
  auth.signInWithPassword.mockReset();
  auth.updateUser.mockReset();
  from.mockReset();
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { role: 'staff' } }),
        }),
      }),
    }),
  });
});

describe('StaffBooking deep-link compatibility', () => {
  it('opens the workspace with the route booking selected', async () => {
    render(
      <MemoryRouter initialEntries={['/staff/b1']}>
        <Routes>
          <Route path="/staff" element={<StaffBooking />} />
          <Route path="/staff/:bookingId" element={<StaffBooking />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Alice Example/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice Example/i })).toBeInTheDocument();
  });
});
