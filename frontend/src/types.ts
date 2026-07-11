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
