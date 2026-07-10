import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const invoke = vi.fn();
vi.mock('./supabase', () => ({ supabase: { from: (...a: any[]) => from(...a), functions: { invoke: (...a: any[]) => invoke(...a) } } }));

import { getAppConfig, addBookingItem, deliverBooking, listPendingBookings } from './api';

beforeEach(() => { from.mockReset(); invoke.mockReset(); });

describe('getAppConfig', () => {
  it('maps app_config rows to purchaseEnabled + pricingMode', async () => {
    from.mockReturnValue({ select: () => Promise.resolve({ data: [
      { key: 'floral_purchase_enabled', value: false },
      { key: 'pricing_mode', value: 'placeholder' },
    ], error: null }) });
    const cfg = await getAppConfig();
    expect(cfg).toEqual({ purchaseEnabled: false, pricingMode: 'placeholder' });
  });
});

describe('addBookingItem', () => {
  it('inserts a booking_items row and returns the mapped item', async () => {
    const insertReturn = { select: () => ({ single: () => Promise.resolve({
      data: { id: 'i1', booking_id: 'b1', variant_id: 'v1', option_snapshot: {}, price_cents_snapshot: 3800, quantity: 1 },
      error: null }) }) };
    from.mockReturnValue({ insert: () => insertReturn });
    const item = await addBookingItem('b1', 'v1', {}, 1);
    expect(item.priceCentsSnapshot).toBe(3800);
    expect(from).toHaveBeenCalledWith('booking_items');
  });
});

describe('deliverBooking', () => {
  it('invokes the edge function and returns status', async () => {
    invoke.mockResolvedValue({ data: { status: 'delivered' }, error: null });
    const res = await deliverBooking('b1');
    expect(res.status).toBe('delivered');
    expect(invoke).toHaveBeenCalledWith('deliver-booking', { body: { booking_id: 'b1' } });
  });
});

describe('listPendingBookings', () => {
  it('returns non-delivered bookings mapped to Booking', async () => {
    const rows = [{ id: 'b2', customer_name: 'Alice', email: 'a@x', slot_at: null,
      coffee_price_cents: 650, redemption_token: 't2', status: 'pending' }];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const neq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ neq }));
    from.mockReturnValue({ select });
    const out = await listPendingBookings();
    expect(neq).toHaveBeenCalledWith('status', 'delivered');
    expect(out[0]).toMatchObject({ id: 'b2', customerName: 'Alice', status: 'pending' });
  });
});
