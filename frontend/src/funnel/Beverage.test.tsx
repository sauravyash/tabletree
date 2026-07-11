import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
const api = { getConfigList: vi.fn(), setBeverage: vi.fn() };
vi.mock('../api', () => api);
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' } }) }));
import Beverage from './Beverage';
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); navigate.mockReset();
  api.getConfigList.mockResolvedValue(['Latte', 'Tea']); api.setBeverage.mockResolvedValue(undefined); });
describe('Beverage', () => {
  it('records the chosen beverage and advances to /address', async () => {
    render(<Beverage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Latte' }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(api.setBeverage).toHaveBeenCalledWith('Latte'));
    expect(navigate).toHaveBeenCalledWith('/address');
  });
});
