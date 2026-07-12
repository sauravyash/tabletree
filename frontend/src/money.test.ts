import { describe, it, expect } from 'vitest';
import { formatPrice, formatMoney } from './money';

describe('formatPrice', () => {
  it('shows placeholder when unpriced', () => {
    expect(formatPrice(null, 'placeholder')).toBe('$—');
  });
  it('shows placeholder mode even when a price exists', () => {
    expect(formatPrice(3800, 'placeholder')).toBe('$—');
  });
  it('formats cents as dollars in sample mode', () => {
    expect(formatPrice(3800, 'sample')).toBe('$38');
  });
});

describe('formatMoney', () => {
  it('formats whole and fractional dollars with two decimals', () => {
    expect(formatMoney(500)).toBe('$5.00');
    expect(formatMoney(450)).toBe('$4.50');
    expect(formatMoney(0)).toBe('$0.00');
  });
});
