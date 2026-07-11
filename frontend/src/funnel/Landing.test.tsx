import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const { api, navigate, refresh } = vi.hoisted(() => ({
  api: { startDraftBooking: vi.fn(), setBookingWish: vi.fn() },
  navigate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams('store=SHOP42')] }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ loading: false, refresh }) }));
import Landing from './Landing';
beforeEach(() => { api.startDraftBooking.mockReset(); api.setBookingWish.mockReset(); navigate.mockReset(); refresh.mockReset();
  api.startDraftBooking.mockResolvedValue('bk-1'); });
describe('Landing', () => {
  it('starts a draft with the store code from the URL', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledWith('SHOP42'));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /get started/i })).toBeEnabled();
  });

  it('allows the visitor to retry draft setup if it fails', async () => {
    api.startDraftBooking.mockRejectedValueOnce(new Error('Session not ready'));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t prepare your delivery/i);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /get started/i })).toBeEnabled();
  });
  it('saves a wish against the draft booking', async () => {
    api.setBookingWish.mockResolvedValue(undefined);
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/make a wish/i), { target: { value: 'A sunny kitchen corner' } });
    fireEvent.click(await screen.findByRole('button', { name: /save wish/i }));
    await waitFor(() => expect(api.setBookingWish).toHaveBeenCalledWith('A sunny kitchen corner'));
    expect(await screen.findByRole('status')).toHaveTextContent(/wish saved/i);
    expect(screen.getByText(/wish sent/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save wish/i })).not.toBeInTheDocument();
  });
  it('saves a typed wish before advancing to /beverage', async () => {
    api.setBookingWish.mockResolvedValue(undefined);
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/make a wish/i), { target: { value: 'A sunny kitchen corner' } });
    fireEvent.click(await screen.findByRole('button', { name: /get started/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/beverage'));
    expect(api.setBookingWish).toHaveBeenCalledWith('A sunny kitchen corner');
  });
});
