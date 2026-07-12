import { describe, it, expect } from 'vitest';
import { cheapestVariant, freeEligibleIds, variantLabel } from './gift';
import type { Product, Variant } from '../types';

const v = (id: string, over: Partial<Variant> = {}): Variant => ({
  id, productId: 'p', size: 'std', flowerCount: null, foliageLevel: null,
  priceCents: null, options: [], ...over,
});

const bevProducts: Product[] = [
  { id: 'pf', name: 'Flat white', slug: 'fw', description: null, category: 'beverage',
    variants: [v('bf', { priceCents: 500 })] },
  { id: 'pt', name: 'Tea', slug: 'tea', description: null, category: 'beverage',
    variants: [v('bt', { priceCents: 400 })] },
  { id: 'pl', name: 'Long black', slug: 'lb', description: null, category: 'beverage',
    variants: [v('bl', { priceCents: 400 })] },
];

const flowerProducts: Product[] = [
  { id: 'tt', name: 'Table Tree', slug: 'table-tree', description: null, category: 'flower',
    variants: [v('s', { size: 'S', flowerCount: 1 }), v('m', { size: 'M', flowerCount: 1 }),
               v('l', { size: 'L', flowerCount: 1 })] },
];

describe('freeEligibleIds', () => {
  it('for beverages returns every variant tied at the cheapest price', () => {
    expect(freeEligibleIds(bevProducts, 'beverage')).toEqual(new Set(['bt', 'bl']));
  });
  it('for flowers returns exactly the single cheapest variant', () => {
    expect(freeEligibleIds(flowerProducts, 'flower')).toEqual(new Set(['s']));
  });
});

describe('cheapestVariant', () => {
  it('ranks null prices by flowerCount then size order', () => {
    expect(cheapestVariant(flowerProducts[0].variants)?.id).toBe('s');
  });
});

describe('variantLabel', () => {
  it('labels a beverage by product name only', () => {
    expect(variantLabel(bevProducts[0], bevProducts[0].variants[0])).toBe('Flat white');
  });
  it('labels a flower with its size', () => {
    expect(variantLabel(flowerProducts[0], flowerProducts[0].variants[0])).toBe('Table Tree — Small');
  });
});
