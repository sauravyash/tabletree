import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
const api = { ensureAnonSession: vi.fn(), getMyDraftBooking: vi.fn() };
vi.mock('../api', () => api);
import { FunnelProvider, useFunnel } from './FunnelContext';
function Probe() { const { booking, loading } = useFunnel();
  return <div>{loading ? 'loading' : `booking:${booking?.id ?? 'none'}`}</div>; }
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.ensureAnonSession.mockResolvedValue(undefined); });
describe('FunnelProvider', () => {
  it('ensures a session then hydrates the draft booking', async () => {
    api.getMyDraftBooking.mockResolvedValue({ id: 'bk-9', status: 'draft' });
    render(<FunnelProvider><Probe /></FunnelProvider>);
    await waitFor(() => expect(screen.getByText('booking:bk-9')).toBeInTheDocument());
    expect(api.ensureAnonSession).toHaveBeenCalled();
  });
  it('exposes null booking when there is no draft', async () => {
    api.getMyDraftBooking.mockResolvedValue(null);
    render(<FunnelProvider><Probe /></FunnelProvider>);
    await waitFor(() => expect(screen.getByText('booking:none')).toBeInTheDocument());
  });
});
