import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { Product } from '../types';
import { formatMoney } from '../money';

export default function Beverage() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const [products, setProducts] = useState<Product[]>([]);
  const [choice, setChoice] = useState<string | null>(null); // variant id
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!booking) { navigate('/'); return; }
    let cancelled = false;
    import('../api').then(async (api) => {
      const list = await api.getProductsByCategory('beverage');
      if (!cancelled) setProducts(list);
    });
    return () => { cancelled = true; };
  }, [booking?.id, navigate]);

  const flat = products.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v })));
  const chosen = flat.find((x) => x.variant.id === choice);

  async function onContinue() {
    if (saving || !booking) return;
    setSaving(true);
    const api = await import('../api');
    if (chosen) {
      const items = await api.getBookingItems(booking.id);
      await Promise.all(items.filter((i) => !i.isGift).map((i) => api.removeBookingItem(i.id)));
      await api.addBookingItem(booking.id, chosen.variant.id, {}, 1, false);
    }
    navigate('/address');
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 2 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '33.333%' }} /></div>
        <h1>What's your usual?</h1>
        <p>Choose your beverage.</p>
      </header>
      <section className="funnel-card beverage-card" aria-label="Choose a beverage">
        <div className="beverage-grid">
          {flat.map(({ product, variant }) => (
            <button key={variant.id} className="beverage-option" aria-pressed={choice === variant.id}
              onClick={() => setChoice(variant.id)}>
              <span className="beverage-mark" aria-hidden="true">{product.slug === 'tea' ? '✦' : '☕'}</span>
              <span>{product.name}</span>
              <span className="beverage-price">{formatMoney(variant.priceCents ?? 0)}</span>
            </button>
          ))}
        </div>
        <button className="add-btn funnel-action" onClick={onContinue} disabled={saving}>
          {chosen ? `Continue with ${chosen.product.name}` : 'Continue without choosing'}
        </button>
      </section>
    </div></div>
  );
}
