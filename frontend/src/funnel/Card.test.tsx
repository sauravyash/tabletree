import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { finalizeDraftBooking: vi.fn() };
vi.mock('../api', () => api);

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft', customerName: 'Ada' } }) }));
vi.mock('../pages/CardSave', () => ({
  default: ({ bookingId, onSaved }: { bookingId: string; onSaved?: (id: string) => void | Promise<void> }) => (
    <button onClick={() => onSaved?.(bookingId)}>save card</button>
  ),
}));

import Card from './Card';

beforeEach(() => {
  api.finalizeDraftBooking.mockReset();
  navigate.mockReset();
  api.finalizeDraftBooking.mockResolvedValue(undefined);
});

describe('funnel Card', () => {
  it('finalizes the booking and routes to /bonus-flowers after save', async () => {
    render(<Card />);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    await waitFor(() => expect(api.finalizeDraftBooking).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/bonus-flowers');
  });
});
