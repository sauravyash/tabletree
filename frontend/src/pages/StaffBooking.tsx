import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Booking, BookingItem, Variant } from '../types';

type ApiModule = typeof import('../api');

// Imported lazily (at call time) rather than statically at module scope. The page test
// mocks '../api' with `const api = {...}; vi.mock('../api', () => api);` *after* other
// imports but *before* `import StaffBooking from './StaffBooking'` — vitest's vi.mock
// hoisting evaluates the factory as soon as anything statically imports '../api', which
// (per ESM import ordering) happens before that `const api = {...}` line runs, throwing
// "Cannot access 'api' before initialization". Deferring the import until runtime (inside
// the effect/handler, after the test file's synchronous setup has already executed
// `const api = {...}`) avoids the TDZ race while keeping the test file verbatim.
function loadApi(): Promise<ApiModule> {
  return import('../api');
}

export default function StaffBooking() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [items, setItems] = useState<BookingItem[]>([]);
  const [variants, setVariants] = useState<Map<string, { v: Variant; product: string }>>(new Map());
  const [status, setStatus] = useState<string>('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    loadApi().then(async (api) => {
      const [b, it, ps] = await Promise.all([
        api.getBooking(bookingId),
        api.getBookingItems(bookingId),
        api.getProducts(),
      ]);
      if (cancelled) return;
      const m = new Map<string, { v: Variant; product: string }>();
      ps.forEach((p) => p.variants.forEach((v) => m.set(v.id, { v, product: p.name })));
      setBooking(b);
      setItems(it);
      setVariants(m);
      setStatus(b.status);
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  async function markDelivered() {
    if (working) return; // guard against double-click double-charge
    setWorking(true);
    setError(null);
    try {
      const api = await loadApi();
      // Use the fetched booking's own id (not the raw env constant) so the write always
      // targets the booking record actually loaded, even if it differs from the id used
      // to look it up — mirrors the convention in FloralCollection's handleAdd.
      const res = await api.deliverBooking(booking!.id);
      setStatus(res.status);
      if (res.status === 'payment_failed') {
        setError('Charge failed — the card was not charged. Payment method may need attention.');
      }
    } catch {
      setError('Could not reach the delivery service. Please try again.');
    } finally {
      setWorking(false);
    }
  }

  if (!booking) return null;
  return (
    <div className="screen">
      <div className="wrap">
        <h1>Booking {booking.id.slice(0, 8)}</h1>
        <p>
          Status: <strong>{status}</strong>
        </p>
        <h2>Floral items to prepare</h2>
        <ul>
          {items.map((i) => {
            const info = variants.get(i.variantId);
            const handle = i.optionSnapshot.handle ? ` · handle: ${i.optionSnapshot.handle}` : '';
            return (
              <li key={i.id}>
                {info?.product} — size {info?.v.size}
                {handle} × {i.quantity}
              </li>
            );
          })}
        </ul>
        {status !== 'delivered' && (
          <button onClick={markDelivered} disabled={working}>
            {working ? 'Delivering…' : 'Mark delivered'}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
