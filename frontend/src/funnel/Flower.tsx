import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { AppConfig, BookingItem, Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { ContinueBar } from '../components/ContinueBar';

// The flower step is a live purchase page: force purchaseEnabled so ProductCard's
// Add buttons are active regardless of the (retired) floral_purchase_enabled flag.
// Flowers are unpriced, so pricingMode is irrelevant here (ProductCard shows $—).
const PURCHASE_CONFIG: AppConfig = { purchaseEnabled: true, pricingMode: 'placeholder' };

export default function Flower() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<BookingItem[]>([]);

  useEffect(() => {
    if (!booking) { navigate('/'); return; }
    let cancelled = false;
    import('../api').then(async (api) => {
      const [prods, its] = await Promise.all([
        api.getProductsByCategory('flower'),
        api.getBookingItems(booking.id),
      ]);
      if (cancelled) return;
      setProducts(prods);
      setItems(its.filter((i) => !i.isGift));
    });
    return () => { cancelled = true; };
    // Depend on booking?.id (not the booking object) — the mocked booking object in tests
    // is recreated each render, which would otherwise re-fire this effect and leak real
    // API calls. Safe because FunnelGate keeps this step unmounted until booking resolves.
  }, [booking?.id, navigate]);

  async function handleAdd(variantId: string, options: Record<string, string>): Promise<BookingItem> {
    const api = await import('../api');
    const item = await api.addBookingItem(booking!.id, variantId, options, 1, false);
    setItems((prev) => [...prev, item]);
    return item;
  }
  async function handleRemove(itemId: string): Promise<void> {
    const api = await import('../api');
    await api.removeBookingItem(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  const goToAddress = () => navigate('/address');
  if (!booking) return null;

  return (
    <>
      <div className="grain" />
      <div className="screen"><div className="wrap">
        <header className="head">
          <p className="eyebrow">Step 2 of 6</p>
          <h1>Pick your flowers</h1>
          <p>Choose an arrangement — add as many as you like.</p>
        </header>
        <div className="grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} config={PURCHASE_CONFIG}
              onAdd={handleAdd} onRemove={handleRemove} />
          ))}
        </div>
      </div></div>
      <ContinueBar count={items.length} onSkip={goToAddress} onContinue={goToAddress} />
    </>
  );
}
