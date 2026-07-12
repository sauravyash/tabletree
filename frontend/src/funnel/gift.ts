import type { Product, Variant } from '../types';

const SIZE_ORDER = ['S', 'M', 'L', 'MD', 'LG'];
const SIZE_LABEL: Record<string, string> = { S: 'Small', M: 'Medium', L: 'Large', MD: 'Medium', LG: 'Large' };

export function flattenVariants(products: Product[]): { product: Product; variant: Variant }[] {
  return products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));
}

export function variantLabel(product: Product, variant: Variant): string {
  if (product.category === 'beverage') return product.name;
  const size = SIZE_LABEL[variant.size] ?? variant.size;
  return `${product.name} — ${size}`;
}

const sizeRank = (size: string) => {
  const i = SIZE_ORDER.indexOf(size);
  return i === -1 ? SIZE_ORDER.length : i;
};

export function cheapestVariant(variants: Variant[]): Variant | null {
  if (variants.length === 0) return null;
  return [...variants].sort((a, b) => {
    const pa = a.priceCents ?? Infinity;
    const pb = b.priceCents ?? Infinity;
    if (pa !== pb) return pa - pb;
    const fa = a.flowerCount ?? 0;
    const fb = b.flowerCount ?? 0;
    if (fa !== fb) return fa - fb;
    return sizeRank(a.size) - sizeRank(b.size);
  })[0];
}

export function freeEligibleIds(products: Product[], oppositeCategory: 'beverage' | 'flower'): Set<string> {
  const variants = flattenVariants(products).map((x) => x.variant);
  if (oppositeCategory === 'beverage') {
    const priced = variants.filter((v) => v.priceCents != null);
    if (priced.length === 0) return new Set();
    const min = Math.min(...priced.map((v) => v.priceCents as number));
    return new Set(priced.filter((v) => v.priceCents === min).map((v) => v.id));
  }
  const cheapest = cheapestVariant(variants);
  return cheapest ? new Set([cheapest.id]) : new Set();
}
