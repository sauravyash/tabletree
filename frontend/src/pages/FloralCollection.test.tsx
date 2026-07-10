import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = { getProducts: vi.fn(), getAppConfig: vi.fn(), getBooking: vi.fn(),
              getBookingItems: vi.fn(), addBookingItem: vi.fn(), removeBookingItem: vi.fn() };
vi.mock('../api', () => api);
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import FloralCollection from './FloralCollection';

const products = [{ id: 'p1', name: 'Table Tree', slug: 'table-tree', description: null, variants: [
  { id: 'v-m', productId: 'p1', size: 'M', flowerCount: 1, foliageLevel: 'some', priceCents: null, options: [] },
]}];

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getProducts.mockResolvedValue(products);
  api.getBooking.mockResolvedValue({ id: 'b1', redemptionToken: 't', status: 'pending', coffeePriceCents: 500, customerName: null, email: null, slotAt: null });
  api.getBookingItems.mockResolvedValue([]);
});

describe('preview-only mode (flag off)', () => {
  it('disables Add and shows placeholder price, never calls addBookingItem', async () => {
    api.getAppConfig.mockResolvedValue({ purchaseEnabled: false, pricingMode: 'placeholder' });
    render(<FloralCollection />);
    const addBtn = await screen.findByRole('button', { name: /coming soon|schedule delivery/i });
    expect(addBtn).toBeDisabled();
    expect(screen.getAllByText('$—').length).toBeGreaterThan(0);
    fireEvent.click(addBtn);
    expect(api.addBookingItem).not.toHaveBeenCalled();
  });
});

describe('purchase enabled', () => {
  it('adds an item and flips the button to Added', async () => {
    api.getAppConfig.mockResolvedValue({ purchaseEnabled: true, pricingMode: 'sample' });
    api.getProducts.mockResolvedValue([{ ...products[0], variants: [{ ...products[0].variants[0], priceCents: 3800 }] }]);
    api.addBookingItem.mockResolvedValue({ id: 'i1', bookingId: 'b1', variantId: 'v-m', optionSnapshot: {}, priceCentsSnapshot: 3800, quantity: 1 });
    render(<FloralCollection />);
    const addBtn = await screen.findByRole('button', { name: /schedule delivery/i });
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);
    await waitFor(() => expect(api.addBookingItem).toHaveBeenCalledWith('b1', 'v-m', {}, 1));
    await screen.findByRole('button', { name: /added/i });
  });
});
