import type { PricingMode } from './types';

export function formatPrice(cents: number | null, mode: PricingMode): string {
  if (mode === 'placeholder' || cents == null) return '$—';
  return '$' + Math.round(cents / 100);
}

export function formatMoney(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}
