import { supabase } from './supabase';
import type { Product, Variant, Booking, BookingItem, AppConfig, PricingMode } from './types';

export async function getAppConfig(): Promise<AppConfig> {
  const { data, error } = await supabase.from('app_config').select();
  if (error) throw error;
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return {
    purchaseEnabled: map.get('floral_purchase_enabled') === true,
    pricingMode: (map.get('pricing_mode') ?? 'placeholder') as PricingMode,
  };
}

export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,product_variants(id,product_id,size,flower_count,foliage_level,price_cents,variant_options(option_key,option_value))')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((p: any): Product => ({
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    variants: (p.product_variants ?? []).map((v: any): Variant => ({
      id: v.id, productId: v.product_id, size: v.size,
      flowerCount: v.flower_count, foliageLevel: v.foliage_level, priceCents: v.price_cents,
      options: (v.variant_options ?? []).map((o: any) => ({ key: o.option_key, value: o.option_value })),
    })),
  }));
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
           optionSnapshot: r.option_snapshot ?? {}, priceCentsSnapshot: r.price_cents_snapshot, quantity: r.quantity };
}
export async function getBookingItems(bookingId: string): Promise<BookingItem[]> {
  const { data, error } = await supabase.from('booking_items').select().eq('booking_id', bookingId);
  if (error) throw error;
  return (data ?? []).map(mapItem);
}

export async function addBookingItem(bookingId: string, variantId: string,
    options: Record<string,string>, quantity = 1): Promise<BookingItem> {
  const { data, error } = await supabase.from('booking_items')
    .insert({ booking_id: bookingId, variant_id: variantId, option_snapshot: options, quantity, price_cents_snapshot: 0 })
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
