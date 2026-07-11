import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { setAddress: vi.fn() };
vi.mock('../api', () => api);

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const refresh = vi.fn();
vi.mock('./FunnelContext', () => ({ useFunnel: () => ({ booking: { id: 'bk-1', status: 'draft' }, refresh }) }));

import Address from './Address';

function fill() {
  fireEvent.change(screen.getByLabelText(/address line 1/i), { target: { value: '1 King St' } });
  fireEvent.change(screen.getByLabelText(/suburb/i), { target: { value: 'Sydney' } });
  fireEvent.change(screen.getByLabelText(/postcode/i), { target: { value: '2000' } });
}

beforeEach(() => {
  api.setAddress.mockReset();
  navigate.mockReset();
  refresh.mockReset();
});

describe('Address', () => {
  it('advances to /slot when in range', async () => {
    api.setAddress.mockResolvedValue(true);
    render(<Address />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/slot'));
    expect(refresh).toHaveBeenCalled();
  });

  it('blocks and shows a message when out of range', async () => {
    api.setAddress.mockResolvedValue(false);
    render(<Address />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/not in our delivery area/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
