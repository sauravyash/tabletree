// Note: `types.ts` is created in Task 6; until then, PricingMode is inlined
// here. Task 6 replaces this with `import type { PricingMode } from './types';`
type PricingMode = 'placeholder' | 'sample';

export function formatPrice(cents: number | null, mode: PricingMode): string {
  if (mode === 'placeholder' || cents == null) return '$—';
  return '$' + Math.round(cents / 100);
}
