import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Booking } from '../types';

export default function StaffBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('../api')
      .then((api) => api.listPendingBookings())
      .then((b) => { if (!cancelled) setBookings(b); })
      .catch(() => { if (!cancelled) setError('Could not load bookings.'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="screen">
      <div className="wrap">
        <h1>Pending deliveries</h1>
        {error && <p role="alert">{error}</p>}
        {bookings.length === 0 && !error && <p>No pending bookings.</p>}
        <ul>
          {bookings.map((b) => (
            <li key={b.id}>
              <Link to={`/staff/${b.id}`}>
                {b.customerName ?? b.id.slice(0, 8)} — {b.status} · coffee ${(b.coffeePriceCents ?? 0) / 100}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
