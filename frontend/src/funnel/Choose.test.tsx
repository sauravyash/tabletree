import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const { api, navigate } = vi.hoisted(() => ({
  api: { setPurchaseCategory: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));
import Choose from './Choose';
beforeEach(() => { api.setPurchaseCategory.mockReset().mockResolvedValue(undefined); navigate.mockReset(); });
describe('Choose', () => {
  it('records the beverage category and advances to /beverage', async () => {
    render(<Choose />);
    fireEvent.click(screen.getByRole('button', { name: /a beverage/i }));
    await waitFor(() => expect(api.setPurchaseCategory).toHaveBeenCalledWith('beverage'));
    expect(navigate).toHaveBeenCalledWith('/beverage');
  });
  it('records the flower category and advances to /flower', async () => {
    render(<Choose />);
    fireEvent.click(screen.getByRole('button', { name: /a flower/i }));
    await waitFor(() => expect(api.setPurchaseCategory).toHaveBeenCalledWith('flower'));
    expect(navigate).toHaveBeenCalledWith('/flower');
  });
});
