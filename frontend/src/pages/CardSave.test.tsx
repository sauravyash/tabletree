import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { confirmSetup, api, navigate } = vi.hoisted(() => ({
  confirmSetup: vi.fn(),
  api: { createSetupIntent: vi.fn(), saveCard: vi.fn(), getBooking: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup }),
  useElements: () => ({}),
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('../stripe', () => ({ stripePublishableKey: () => 'pk_test_mock' }));

vi.mock('../api', () => api);
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as any), useNavigate: () => navigate }));

import CardSave from './CardSave';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  confirmSetup.mockReset(); navigate.mockReset();
  api.getBooking.mockResolvedValue({ id: 'b2', status: 'pending', coffeePriceCents: 650, customerName: 'Alice', email: 'a@x', slotAt: null, redemptionToken: 't' });
  api.createSetupIntent.mockResolvedValue({ clientSecret: 'seti_x_secret' });
});

describe('CardSave', () => {
  it('fetches a client secret and renders the payment element', async () => {
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    await waitFor(() => expect(api.createSetupIntent).toHaveBeenCalledWith('b2'));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
  });

  it('saves the card and navigates on successful confirmation', async () => {
    confirmSetup.mockResolvedValue({ setupIntent: { id: 'seti_1', status: 'succeeded' } });
    api.saveCard.mockResolvedValue({ saved: true });
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    await waitFor(() => expect(api.saveCard).toHaveBeenCalledWith('b2', 'seti_1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('surfaces a confirmation error', async () => {
    confirmSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    render(<MemoryRouter><CardSave bookingId="b2" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /save card/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/declined/i);
  });
});
