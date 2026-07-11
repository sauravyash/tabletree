import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const { useFunnel } = vi.hoisted(() => ({ useFunnel: vi.fn() }));
vi.mock('./FunnelContext', () => ({ useFunnel }));
import FunnelGate from './FunnelGate';

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/beverage']}>
      <Routes>
        <Route element={<FunnelGate />}>
          <Route path="/beverage" element={<div>STEP CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { useFunnel.mockReset(); });

describe('FunnelGate', () => {
  it('shows a loader and withholds the step while the draft is loading', () => {
    useFunnel.mockReturnValue({ loading: true });
    renderGate();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('STEP CONTENT')).not.toBeInTheDocument();
  });

  it('renders the step route once loading has finished', () => {
    useFunnel.mockReturnValue({ loading: false });
    renderGate();
    expect(screen.getByText('STEP CONTENT')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
