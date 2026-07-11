import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { upgradeAccount: vi.fn(), setCustomer: vi.fn() };
vi.mock('../api', () => api);

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const refresh = vi.fn();
const future = new Date(Date.now() + 5 * 60_000).toISOString();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({
  booking: { id: 'bk-1', status: 'draft', postcode: '2017', holdExpiresAt: future }, refresh,
}) }));

import Account from './Account';

function fill() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@x.co' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter2hunter2' } });
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  navigate.mockReset();
  refresh.mockReset();
});

describe('Account', () => {
  it('shows the remaining server-held slot time', () => {
    render(<Account />);
    expect(screen.getByRole('status')).toHaveTextContent(/delivery slot is held for 4:|delivery slot is held for 5:/i);
  });

  it('returns to slot selection when the hold expires', () => {
    vi.useFakeTimers();
    render(<Account />);
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(navigate).toHaveBeenCalledWith('/slot');
    vi.useRealTimers();
  });

  it('upgrades, stamps the name, and advances to /card', async () => {
    api.upgradeAccount.mockResolvedValue(undefined);
    api.setCustomer.mockResolvedValue(undefined);
    render(<Account />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(api.upgradeAccount).toHaveBeenCalledWith('ada@x.co', 'hunter2hunter2'));
    expect(api.setCustomer).toHaveBeenCalledWith('Ada');
    expect(navigate).toHaveBeenCalledWith('/card');
  });

  it('shows an inline error when the email is already registered', async () => {
    api.upgradeAccount.mockRejectedValue(new Error('email address already in use'));
    render(<Account />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await screen.findByText(/already registered|already in use/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
