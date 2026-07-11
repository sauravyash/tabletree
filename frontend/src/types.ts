export type PricingMode = 'placeholder' | 'sample';

export interface VariantOption { key: string; value: string }

export interface Variant {
  id: string;
  productId: string;
  size: string;           // 'S'|'M'|'L'|'MD'|'LG'
  flowerCount: number;
  foliageLevel: string;
  priceCents: number | null;
  options: VariantOption[];
}

export interface Product {
  id: string; name: string; slug: string; description: string | null;
  variants: Variant[];
}

export interface Booking {
  id: string; customerName: string | null; email: string | null;
  slotAt: string | null; coffeePriceCents: number | null;
  redemptionToken: string; status: string;
}

export interface BookingItem {
  id: string; bookingId: string; variantId: string;
  optionSnapshot: Record<string, string>;
  priceCentsSnapshot: number; quantity: number;
}

export interface AppConfig { purchaseEnabled: boolean; pricingMode: PricingMode }

export interface StaffProfile {
  displayName: string;
  phone: string;
  avatarUrl: string;
  email: string;
}

export interface DraftBooking {
  id: string; storeCode: string | null; beverage: string | null;
  wish: string | null;
  addressLine1: string | null; addressLine2: string | null;
  suburb: string | null; postcode: string | null;
  slotAt: string | null; holdExpiresAt: string | null;
  customerName: string | null; email: string | null; status: string;
}
export interface SlotOption { slotAt: string; remaining: number }
