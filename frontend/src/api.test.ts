import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const invoke = vi.fn();
const rpc = vi.fn();
const { auth } = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), signInAnonymously: vi.fn(), updateUser: vi.fn() },
}));
vi.mock('./supabase', () => ({ supabase: { from: (...a: any[]) => from(...a),
  functions: { invoke: (...a: any[]) => invoke(...a) }, rpc: (...a: any[]) => rpc(...a), auth } }));

import { getAppConfig, addBookingItem, deliverBooking, listPendingBookings, createSetupIntent, saveCard,
  startDraftBooking, setBookingWish, checkPostcode, availableSlots, holdSlot, getConfigList } from './api';

beforeEach(() => { from.mockReset(); invoke.mockReset(); rpc.mockReset(); });

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

describe('card-save api', () => {
  it('createSetupIntent invokes the edge fn and returns the client secret', async () => {
    invoke.mockResolvedValue({ data: { clientSecret: 'seti_x' }, error: null });
    const out = await createSetupIntent('b2');
    expect(invoke).toHaveBeenCalledWith('create-setup-intent', { body: { booking_id: 'b2' } });
    expect(out).toEqual({ clientSecret: 'seti_x' });
  });

  it('saveCard invokes the edge fn with the setup intent id', async () => {
    invoke.mockResolvedValue({ data: { saved: true }, error: null });
    const out = await saveCard('b2', 'seti_1');
    expect(invoke).toHaveBeenCalledWith('save-card', { body: { booking_id: 'b2', setup_intent_id: 'seti_1' } });
    expect(out).toEqual({ saved: true });
  });
});

describe('startDraftBooking', () => {
  it('calls the RPC and returns the id', async () => {
    rpc.mockResolvedValue({ data: 'bk-1', error: null });
    expect(await startDraftBooking('SHOP42')).toBe('bk-1');
    expect(rpc).toHaveBeenCalledWith('start_draft_booking', { p_store_code: 'SHOP42' });
  });
});
describe('setBookingWish', () => {
  it('calls the guarded wish RPC', async () => {
    rpc.mockResolvedValue({ error: null });
    await setBookingWish('A sunny kitchen corner');
    expect(rpc).toHaveBeenCalledWith('set_booking_wish', { p_wish: 'A sunny kitchen corner' });
  });
});
describe('checkPostcode', () => {
  it('returns the boolean', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkPostcode('2017')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('check_postcode', { p_postcode: '2017' });
  });
});
describe('availableSlots', () => {
  it('maps rows to camelCase', async () => {
    rpc.mockResolvedValue({ data: [{ slot_at: '2026-07-12T09:00:00Z', remaining: 2 }], error: null });
    expect(await availableSlots()).toEqual([{ slotAt: '2026-07-12T09:00:00Z', remaining: 2 }]);
  });
});
describe('holdSlot', () => {
  it('returns the boolean', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await holdSlot('2026-07-12T09:00:00Z')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('hold_slot', { p_slot_at: '2026-07-12T09:00:00Z' });
  });
});
describe('getConfigList', () => {
  it('returns the array value for a key', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { value: ['Latte', 'Tea'] }, error: null }) }) }) });
    expect(await getConfigList('beverage_options')).toEqual(['Latte', 'Tea']);
  });
});
