import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { startDraftBooking: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams('store=SHOP42')] }));
const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ refresh }) }));
import Landing from './Landing';
beforeEach(() => { api.startDraftBooking.mockReset(); navigate.mockReset(); refresh.mockReset();
  api.startDraftBooking.mockResolvedValue('bk-1'); });
describe('Landing', () => {
  it('starts a draft with the store code from the URL', async () => {
    render(<Landing />);
    await waitFor(() => expect(api.startDraftBooking).toHaveBeenCalledWith('SHOP42'));
    expect(refresh).toHaveBeenCalled();
  });
  it('advances to /beverage on CTA', async () => {
    render(<Landing />);
    fireEvent.click(await screen.findByRole('button', { name: /get started/i }));
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });
});
