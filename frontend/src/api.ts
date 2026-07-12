import { supabase } from './supabase';
import type { Product, Variant, Booking, BookingItem, AppConfig, PricingMode, DraftBooking, SlotOption } from './types';

export async function getAppConfig(): Promise<AppConfig> {
  const { data, error } = await supabase.from('app_config').select();
  if (error) throw error;
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return {
    purchaseEnabled: map.get('floral_purchase_enabled') === true,
    pricingMode: (map.get('pricing_mode') ?? 'placeholder') as PricingMode,
  };
}

function mapProduct(p: any): Product {
  return {
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    category: p.category,
    variants: (p.product_variants ?? []).map((v: any): Variant => ({
      id: v.id, productId: v.product_id, size: v.size,
      flowerCount: v.flower_count, foliageLevel: v.foliage_level, priceCents: v.price_cents,
      options: (v.variant_options ?? []).map((o: any) => ({ key: o.option_key, value: o.option_value })),
    })),
  };
}

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,category,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map(mapProduct);
}

export async function getProductsByCategory(category: 'beverage' | 'flower'): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,category,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true)
    .eq('category', category);
  if (error) throw error;
  return (data ?? []).map(mapProduct);
}

function mapBooking(b: any): Booking {
  return { id: b.id, customerName: b.customer_name, email: b.email, slotAt: b.slot_at,
           coffeePriceCents: b.coffee_price_cents, redemptionToken: b.redemption_token, status: b.status };
}
export async function getBooking(bookingId: string): Promise<Booking> {
  const { data, error } = await supabase.from('bookings').select().eq('id', bookingId).single();
  if (error) throw error;
  return mapBooking(data);
}

function mapItem(r: any): BookingItem {
  return { id: r.id, bookingId: r.booking_id, variantId: r.variant_id,
           optionSnapshot: r.option_snapshot ?? {}, priceCentsSnapshot: r.price_cents_snapshot,
           quantity: r.quantity, isGift: r.is_gift ?? false };
}
export async function getBookingItems(bookingId: string): Promise<BookingItem[]> {
  const { data, error } = await supabase.from('booking_items').select().eq('booking_id', bookingId);
  if (error) throw error;
  return (data ?? []).map(mapItem);
}

export async function addBookingItem(bookingId: string, variantId: string,
    options: Record<string,string>, quantity = 1, isGift = false): Promise<BookingItem> {
  // price_cents_snapshot is a placeholder; guard_booking_item() (BEFORE INSERT)
  // overwrites it: 0 for gifts, the variant price (or 0 if unpriced) for paid items.
  const { data, error } = await supabase.from('booking_items')
    .insert({ booking_id: bookingId, variant_id: variantId, option_snapshot: options,
              quantity, price_cents_snapshot: 0, is_gift: isGift })
    .select().single();
  if (error) throw error;
  return mapItem(data);
}

export async function removeBookingItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('booking_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function deliverBooking(bookingId: string): Promise<{ status: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('deliver-booking', { body: { booking_id: bookingId } });
  if (error) throw error;
  return data as { status: string; error?: string };
}

export async function listPendingBookings(): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings').select().neq('status', 'delivered').order('slot_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapBooking);
}

export async function createSetupIntent(bookingId: string): Promise<{ clientSecret: string }> {
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: { booking_id: bookingId } });
  if (error) throw error;
  return data as { clientSecret: string };
}

export async function saveCard(bookingId: string, setupIntentId: string): Promise<{ saved: boolean }> {
  const { data, error } = await supabase.functions.invoke('save-card', { body: { booking_id: bookingId, setup_intent_id: setupIntentId } });
  if (error) throw error;
  return data as { saved: boolean };
}

export async function ensureAnonSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
export async function startDraftBooking(storeCode: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('start_draft_booking', { p_store_code: storeCode });
  if (error) throw error; return data as string;
}
export async function setBeverage(beverage: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_beverage', { p_beverage: beverage });
  if (error) throw error;
}
export async function setBookingWish(wish: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_wish', { p_wish: wish });
  if (error) throw error;
}
export async function checkPostcode(postcode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_postcode', { p_postcode: postcode });
  if (error) throw error; return data as boolean;
}
export async function setAddress(a: { line1: string; line2: string; suburb: string; postcode: string }): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_booking_address', {
    p_line1: a.line1, p_line2: a.line2, p_suburb: a.suburb, p_postcode: a.postcode });
  if (error) throw error; return data as boolean;
}
export async function availableSlots(): Promise<SlotOption[]> {
  const { data, error } = await supabase.rpc('available_slots');
  if (error) throw error;
  return (data ?? []).map((r: any): SlotOption => ({ slotAt: r.slot_at, remaining: r.remaining }));
}
export async function holdSlot(slotAt: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('hold_slot', { p_slot_at: slotAt });
  if (error) throw error; return data as boolean;
}
export async function upgradeAccount(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) throw error;
}
export async function setCustomer(name: string): Promise<void> {
  const { error } = await supabase.rpc('set_booking_customer', { p_name: name });
  if (error) throw error;
}
export async function finalizeDraftBooking(): Promise<void> {
  const { error } = await supabase.rpc('finalize_draft_booking');
  if (error) throw error;
}
export async function getConfigList(key: string): Promise<string[]> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
  if (error) throw error; return (data?.value as string[]) ?? [];
}
function mapDraft(b: any): DraftBooking {
  return { id: b.id, storeCode: b.store_code, beverage: b.beverage, wish: b.wish,
    addressLine1: b.address_line1, addressLine2: b.address_line2, suburb: b.suburb,
    postcode: b.postcode, slotAt: b.slot_at, holdExpiresAt: b.hold_expires_at,
    customerName: b.customer_name, email: b.email, status: b.status };
}
export async function getMyDraftBooking(): Promise<DraftBooking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data ? mapDraft(data) : null;
}
export async function setPurchaseCategory(category: 'beverage' | 'flower'): Promise<void> {
  const { error } = await supabase.rpc('set_purchase_category', { p_category: category });
  if (error) throw error;
}
export async function getMyBooking(): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select()
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data ? mapBooking(data) : null;
}
