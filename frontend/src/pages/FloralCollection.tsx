import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppConfig, Booking, BookingItem, Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { ContinueBar } from '../components/ContinueBar';

type ApiModule = typeof import('../api');

// Imported lazily (at call time) rather than statically at module scope. The page test
// mocks '../api' with `const api = {...}; vi.mock('../api', () => api);` *after* other
// imports but *before* `import FloralCollection from './FloralCollection'` — vitest's
// vi.mock hoisting evaluates the factory as soon as anything statically imports '../api',
// which (per ESM import ordering) happens before that `const api = {...}` line runs,
// throwing "Cannot access 'api' before initialization". Deferring the import until
// runtime (inside effects/handlers, after the test file's synchronous setup has already
// executed `const api = {...}`) avoids the TDZ race while keeping the test file verbatim.
function loadApi(): Promise<ApiModule> {
  return import('../api');
}

export default function FloralCollection() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [items, setItems] = useState<BookingItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadApi().then(async (api) => {
      const [cfg, prods, bk] = await Promise.all([
        api.getAppConfig(),
        api.getProducts(),
        api.getMyBooking(),
      ]);
      if (cancelled) return;
      setConfig(cfg);
      setProducts(prods);
      if (!bk) return;
      const its = await api.getBookingItems(bk.id);
      if (cancelled) return;
      setBooking(bk);
      setItems(its);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAdd(variantId: string, options: Record<string, string>): Promise<BookingItem> {
    const api = await loadApi();
    // Use the fetched booking's own id (not the raw env constant) so writes always
    // target the booking record actually loaded, even if it differs from the id used
    // to look it up.
    const item = await api.addBookingItem(booking!.id, variantId, options, 1);
    setItems((prev) => [...prev, item]);
    return item;
  }

  async function handleRemove(itemId: string): Promise<void> {
    const api = await loadApi();
    await api.removeBookingItem(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  const goToConfirmation = () => navigate('/confirmation');

  if (!config || !booking) return null;

  return (
    <>
      <div className="grain" />
      <div className="screen">
        <div className="wrap">
          <header className="head">
            <p className="eyebrow">Before your delivery arrives</p>
            <h1>Add something for the table?</h1>
            <p>A little arrangement to go with your coffee — totally optional, skip any time.</p>
          </header>

          <div className="grid">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                config={config}
                onAdd={handleAdd}
                onRemove={handleRemove}
              />
            ))}
          </div>

          {/* <p className="disclaimer">Pricing shown is a placeholder — final pricing TBD.</p> */}
        </div>
      </div>

      <ContinueBar count={items.length} onSkip={goToConfirmation} onContinue={goToConfirmation} />
    </>
  );
}
