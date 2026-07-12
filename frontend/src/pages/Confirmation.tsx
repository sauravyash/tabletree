import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Booking, BookingItem, Variant } from '../types';
import { formatPrice } from '../money';

type ApiModule = typeof import('../api');

// Imported lazily (at call time) rather than statically at module scope. The page test
// mocks '../api' with `const api = {...}; vi.mock('../api', () => api);` *after* other
// imports but *before* `import Confirmation from './Confirmation'` — vitest's vi.mock
// hoisting evaluates the factory as soon as anything statically imports '../api', which
// (per ESM import ordering) happens before that `const api = {...}` line runs, throwing
// "Cannot access 'api' before initialization". Deferring the import until runtime (inside
// the effect, after the test file's synchronous setup has already executed `const api =
// {...}`) avoids the TDZ race while keeping the test file verbatim.
function loadApi(): Promise<ApiModule> {
  return import('../api');
}

export default function Confirmation() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [variants, setVariants] = useState<Map<string, { v: Variant; product: string }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadApi().then(async (api) => {
      const [b, ps] = await Promise.all([api.getMyBooking(), api.getProducts()]);
      if (cancelled) return;
      if (!b) return;
      const it = await api.getBookingItems(b.id);
      if (cancelled) return;
      const m = new Map<string, { v: Variant; product: string }>();
      ps.forEach((p) => p.variants.forEach((v) => m.set(v.id, { v, product: p.name })));
      setBooking(b);
      setItems(it);
      setVariants(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booking) return null;
  return (
    <div className="screen">
      <div className="wrap">
        <h1>You're all set.</h1>
        <section className="redeem">
          <p className="eyebrow">Your free Table Tree</p>
          <p>Show this code in store to redeem your complimentary Table Tree:</p>
          <code className="token">{booking.redemptionToken}</code>
        </section>
        {items.length > 0 && (
          <section>
            <p className="eyebrow">Added to your delivery</p>
            <ul>
              {items.map((i) => {
                const info = variants.get(i.variantId);
                const handle = i.optionSnapshot.handle ? ` · handle: ${i.optionSnapshot.handle}` : '';
                return (
                  <li key={i.id}>
                    {info?.product} — {info?.v.size}
                    {handle} — {formatPrice(i.priceCentsSnapshot, 'sample')} × {i.quantity}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <button className="confirmation-home-button" type="button" onClick={() => navigate('/')}>
          Return to home
        </button>
      </div>
    </div>
  );
}
