import { useState } from 'react';
import type { AppConfig, BookingItem, Product, Variant } from '../types';
import { formatPrice } from '../money';
import { SizeSelector, type SizeOption } from './SizeSelector';
import { HandleToggle } from './HandleToggle';

interface ProductCardProps {
  product: Product;
  config: AppConfig;
  onAdd: (variantId: string, options: Record<string, string>) => Promise<BookingItem>;
  onRemove: (itemId: string) => Promise<void>;
}

// Copy ported verbatim from floral-collection.html's TT_SIZES / BOX_SIZES tables.
// The API only carries structural fields (size code, flowerCount, foliageLevel); the
// prototype's marketing copy per size isn't part of the data model, so it's kept here
// as a lookup keyed by the size code, with a data-driven fallback for unknown sizes.
const TT_SIZE_META: Record<string, { label: string; dotSize: number; desc: string }> = {
  S: { label: 'Small', dotSize: 16, desc: 'Slight foliage framing one big flower — a quiet, tidy little cup.' },
  M: { label: 'Medium', dotSize: 22, desc: 'Some foliage framing one big flower — a little fuller, still just one hero bloom.' },
  L: { label: 'Large', dotSize: 28, desc: 'Lots of foliage framing one big flower — the flower stays singular, the greenery does the growing.' },
};

const BOX_SIZE_META: Record<string, { label: string; sub: string; desc: string }> = {
  MD: { label: 'Medium', sub: '3 flowers', desc: '3 flowers with appropriate foliage — a balanced arrangement for a side table or console.' },
  LG: { label: 'Large', sub: '5 flowers', desc: '5 flowers with lots of foliage — a fuller statement piece for a living room table.' },
};

function fallbackDesc(v: Variant): string {
  const foliage = v.foliageLevel?.replace(/_/g, ' ');
  return `${v.flowerCount} flower${v.flowerCount === 1 ? '' : 's'} with ${foliage} foliage.`;
}

export function ProductCard({ product, config, onAdd, onRemove }: ProductCardProps) {
  const isBox = product.variants.some((v) => v.options.some((o) => o.key === 'handle'));
  const sizes = product.variants.map((v) => v.size);

  const [selectedSize, setSelectedSize] = useState(sizes[0] ?? '');
  const [handleOn, setHandleOn] = useState(false);
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const variant = product.variants.find((v) => v.size === selectedSize) ?? product.variants[0];

  const sizeMeta = isBox ? BOX_SIZE_META[selectedSize] : TT_SIZE_META[selectedSize];
  const sizeLabel = sizeMeta?.label ?? selectedSize;
  const desc = sizeMeta?.desc ?? (variant ? fallbackDesc(variant) : '');

  const sizeOptions: SizeOption[] = sizes.map((s) => {
    if (isBox) {
      const m = BOX_SIZE_META[s];
      return { key: s, label: m?.label ?? s, sub: m?.sub };
    }
    const m = TT_SIZE_META[s];
    return { key: s, label: m?.label ?? s, dotSize: m?.dotSize ?? 22 };
  });

  const tagline = isBox
    ? 'A larger arrangement for the living space'
    : 'One statement flower, everything in a cup';
  const sizeCaption = isBox ? 'Size' : 'Size — foliage scales up, flower stays the same';

  const photoLabel = isBox
    ? `box bouquet — ${sizeLabel.toLowerCase()} — ${handleOn ? 'with' : 'without'} handle — product photo`
    : `table tree — ${sizeLabel.toLowerCase()} — product photo`;

  const priceText = !config.purchaseEnabled || !variant ? '$—' : formatPrice(variant.priceCents, config.pricingMode);
  const added = addedItemId !== null;
  const label = added
    ? 'Added ✓'
    : !config.purchaseEnabled
      ? 'Coming soon'
      : isBox
        ? 'Add Box Bouquet'
        : 'Schedule Delivery';

  async function handleClick() {
    if (!config.purchaseEnabled || !variant || pending) return;
    setPending(true);
    try {
      if (added && addedItemId) {
        await onRemove(addedItemId);
        setAddedItemId(null);
      } else {
        const options: Record<string, string> = isBox ? { handle: handleOn ? 'with' : 'without' } : {};
        const item = await onAdd(variant.id, options);
        setAddedItemId(item.id);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      <div className="photo">
        <span>{photoLabel}</span>
        <img src={`photos/${product.slug}.jpeg`} />
      </div>

      <div className="title-row">
        <h2>{product.name}</h2>
        <span className="price">{priceText}</span>
      </div>
      <p className="tagline">{tagline}</p>

      <p className="size-label">{sizeCaption}</p>
      <SizeSelector kind={isBox ? 'box' : 'tt'} options={sizeOptions} selected={selectedSize} onSelect={setSelectedSize} />

      {isBox ? <HandleToggle on={handleOn} onToggle={() => setHandleOn((h) => !h)} /> : null}

      <p className="desc">{desc}</p>

      <button
        type="button"
        className={`add-btn${added ? ' added' : ''}`}
        disabled={!config.purchaseEnabled || pending}
        onClick={handleClick}
      >
        {label}
      </button>
      {!config.purchaseEnabled ? <p className="helper">Coming soon — pricing TBD</p> : null}
    </div>
  );
}
