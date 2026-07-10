import type { PricingMode } from './types';

export function formatPrice(cents: number | null, mode: PricingMode): string {
  if (mode === 'placeholder' || cents == null) return '$—';
  return '$' + Math.round(cents / 100);
}
