import { describe, it, expect } from 'vitest';
import { formatPrice } from './money';

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
