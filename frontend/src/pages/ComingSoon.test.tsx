import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ComingSoon from './ComingSoon';

describe('ComingSoon', () => {
  it('renders the section title, a coming-soon note, and a home link', () => {
    render(<MemoryRouter><ComingSoon title="Jobs" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /jobs/i })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
