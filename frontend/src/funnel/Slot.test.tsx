import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { availableSlots: vi.fn(), holdSlot: vi.fn() };
vi.mock('../api', () => api);

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({
  booking: { id: 'bk-1', status: 'draft', postcode: '2000' }, refresh,
}) }));

import Slot from './Slot';

const slots = [
  { slotAt: '2026-07-12T09:00:00Z', remaining: 2 },
  { slotAt: '2026-07-12T10:00:00Z', remaining: 1 },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  navigate.mockReset();
  refresh.mockReset();
  api.availableSlots.mockResolvedValue(slots);
});

describe('Slot', () => {
  it('holds a picked slot and advances to /account', async () => {
    api.holdSlot.mockResolvedValue(true);
    render(<Slot />);
    fireEvent.click((await screen.findAllByRole('button'))[0]);
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith('2026-07-12T09:00:00Z'));
    expect(navigate).toHaveBeenCalledWith('/account');
  });

  it('shows a message and refreshes when the slot was just taken', async () => {
    api.holdSlot.mockResolvedValue(false);
    render(<Slot />);
    const initialLoads = api.availableSlots.mock.calls.length;
    fireEvent.click((await screen.findAllByRole('button'))[0]);
    await screen.findByText(/just taken/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(api.availableSlots.mock.calls.length).toBeGreaterThan(initialLoads);
  });
});
