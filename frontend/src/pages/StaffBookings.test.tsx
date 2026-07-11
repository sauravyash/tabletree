import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import StaffBookings from './StaffBookings';

function makeBookings() {
  const now = new Date();
  return [
    {
      id: 'b-current',
      customerName: 'Alice Example',
      email: 'alice@tabletree.test',
      slotAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      coffeePriceCents: 650,
      redemptionToken: 'a',
      status: 'pending',
    },
    {
      id: 'b-future',
      customerName: 'Bob Example',
      email: 'bob@tabletree.test',
      slotAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      coffeePriceCents: 750,
      redemptionToken: 'b',
      status: 'pending',
    },
    {
      id: 'b-unscheduled',
      customerName: 'Chris Example',
      email: 'chris@tabletree.test',
      slotAt: null,
      coffeePriceCents: 500,
      redemptionToken: 'c',
      status: 'pending',
    },
  ];
}

function staffSession() {
  return {
    data: {
      session: {
        user: {
          id: 'u-f1',
          email: 'staff@tabletree.test',
          user_metadata: {
            displayName: 'Morning lead',
            phone: '0400 111 222',
            avatarUrl: 'https://example.com/avatar.png',
          },
        },
      },
    },
  };
}

function mockStaffRole() {
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { role: 'staff' } }),
        }),
      }),
    }),
  });
}

function renderStaff(initialEntries = ['/staff']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/staff" element={<StaffBookings />} />
        <Route path="/staff/:bookingId" element={<StaffBookings />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listPendingBookings.mockResolvedValue(makeBookings());
  api.getProducts.mockResolvedValue([
    {
      id: 'p1',
      name: 'Living Room Box Bouquet',
      slug: 'box',
      description: null,
      variants: [
        { id: 'v1', productId: 'p1', size: 'MD', flowerCount: 3, foliageLevel: 'balanced', priceCents: 6500, options: [] },
      ],
    },
  ]);
  api.getBookingItems.mockImplementation(async (bookingId: string) => (
    bookingId === 'b-current'
      ? [{ id: 'i1', bookingId, variantId: 'v1', optionSnapshot: { handle: 'with' }, priceCentsSnapshot: 6500, quantity: 1 }]
      : []
  ));
  api.deliverBooking.mockResolvedValue({ status: 'delivered' });
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue(staffSession());
  auth.signInWithPassword.mockReset();
  auth.updateUser.mockReset();
  auth.updateUser.mockResolvedValue({
    data: {
      user: {
        email: 'staff@tabletree.test',
        user_metadata: {
          displayName: 'Morning lead',
          phone: '0400 999 888',
          avatarUrl: 'https://example.com/avatar.png',
        },
      },
    },
    error: null,
  });
  from.mockReset();
  mockStaffRole();
});

describe('StaffBookings workspace', () => {
  it('shows a staff sign-in form when the session is not staff', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });

    renderStaff();

    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /staff tabs/i })).not.toBeInTheDocument();
  });

  it('auto-selects the nearest booking and splits day and future sections', async () => {
    renderStaff();

    expect(await screen.findByText(/Alice Example/)).toBeInTheDocument();
    const currentSection = screen.getByText(/Today & current/i).closest('section');
    const futureSection = screen.getByText(/^Future$/i).closest('section');
    expect(currentSection).not.toBeNull();
    expect(futureSection).not.toBeNull();
    expect(within(currentSection!).getByText(/Alice Example/)).toBeInTheDocument();
    expect(within(currentSection!).getByText(/Chris Example/)).toBeInTheDocument();
    expect(within(futureSection!).getByText(/Bob Example/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Alice Example/i, level: 2 })).toBeInTheDocument();
    expect(await screen.findByText(/handle: with/i)).toBeInTheDocument();
  });

  it('updates the selected detail pane when a future booking is clicked', async () => {
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /Bob Example/i }));

    expect(await screen.findByRole('heading', { name: /Bob Example/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/No floral items for this booking/i)).toBeInTheDocument();
  });

  it('auto-advances to the next booking after delivery and removes the delivered one', async () => {
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /Mark delivered/i }));

    await waitFor(() => expect(api.deliverBooking).toHaveBeenCalledWith('b-current'));
    expect(await screen.findByRole('heading', { name: /Bob Example/i, level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alice Example/i })).not.toBeInTheDocument();
  });

  it('shows a delivery error when the edge function call fails', async () => {
    api.deliverBooking.mockRejectedValue(new Error('network'));
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /Mark delivered/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the delivery service/i);
  });

  it('renders the week tab with grouped bookings', async () => {
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /^Week$/i }));

    expect(await screen.findByText(/Week view/i)).toBeInTheDocument();
    expect(screen.getByText(/Later/i)).toBeInTheDocument();
    expect(screen.getByText(/Unscheduled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice Example/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob Example/i })).toBeInTheDocument();
  });

  it('loads auth metadata in settings and saves changes', async () => {
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /^Settings$/i }));

    const nameInput = await screen.findByLabelText(/display name/i);
    const phoneInput = screen.getByLabelText(/mobile number/i);
    expect(nameInput).toHaveValue('Morning lead');
    expect(screen.getByLabelText(/avatar url/i)).toHaveValue('https://example.com/avatar.png');
    expect(screen.getByLabelText(/email/i)).toHaveValue('staff@tabletree.test');

    fireEvent.change(phoneInput, { target: { value: '0400 999 888' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({
      data: {
        displayName: 'Morning lead',
        phone: '0400 999 888',
        avatarUrl: 'https://example.com/avatar.png',
      },
    }));
    expect(await screen.findByText(/Settings saved/i)).toBeInTheDocument();
  });

  it('surfaces a settings save failure', async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('nope') });
    renderStaff();

    fireEvent.click(await screen.findByRole('button', { name: /^Settings$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save settings/i);
  });
});
