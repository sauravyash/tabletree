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
beforeEach(() => {
  api.startDraftBooking.mockReset(); api.setBookingWish.mockReset();
  navigate.mockReset(); refresh.mockReset();
  api.startDraftBooking.mockResolvedValue('bk-1');
});

describe('KosList Landing', () => {
  it('starts a draft with the store code from the URL', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledWith('SHOP42'));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders the wordmark, chips and cards with no submit button', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: /koslist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^jobs$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /co-work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manifestables/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /koskup/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/ask me anything/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('saves the query as a wish and shows the animation on Enter', async () => {
    api.setBookingWish.mockResolvedValue(undefined);
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.change(input, { target: { value: 'a quiet desk near a window' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.setBookingWish).toHaveBeenCalledWith('a quiet desk near a window'));
    expect(await screen.findByText(/wish sent/i)).toBeInTheDocument();
  });

  it('does nothing on Enter when the input is empty', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.submit(input.closest('form')!);
    expect(api.setBookingWish).not.toHaveBeenCalled();
  });

  it('does not save a wish until the draft is ready', async () => {
    api.startDraftBooking.mockRejectedValueOnce(new Error('not ready'));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/get things ready/i);
    const input = screen.getByLabelText(/ask me anything/i);
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    expect(api.setBookingWish).not.toHaveBeenCalled();
  });

  it('navigates from the chips and the KosKup card', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^jobs$/i }));
    expect(navigate).toHaveBeenCalledWith('/jobs');
    fireEvent.click(screen.getByRole('button', { name: /co-work/i }));
    expect(navigate).toHaveBeenCalledWith('/cowork');
    fireEvent.click(screen.getByRole('button', { name: /koskup/i }));
    expect(navigate).toHaveBeenCalledWith('/choose');
  });

  it('retries draft setup when it fails', async () => {
    api.startDraftBooking.mockRejectedValueOnce(new Error('Session not ready'));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledTimes(2));
  });
});
