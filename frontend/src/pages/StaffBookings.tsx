import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import type { Booking } from '../types';

async function currentUserIsStaff(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data } = await supabase.from('user_roles')
    .select('role').eq('user_id', session.user.id).eq('role', 'staff').maybeSingle();
  return !!data;
}

export default function StaffBookings() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function refresh() {
    const staff = await currentUserIsStaff();
    setIsStaff(staff);
    if (staff) {
      const api = await import('../api');
      try { setBookings(await api.listPendingBookings()); }
      catch { setError('Could not load bookings.'); }
    }
  }
  useEffect(() => { refresh(); }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Sign-in failed.'); return; }
    await refresh();
  }

  if (isStaff === null) return null;

  if (!isStaff) {
    return (
      <div className="screen"><div className="wrap">
        <h1>Staff sign-in</h1>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={signIn}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit">Sign in</button>
        </form>
      </div></div>
    );
  }

  return (
    <div className="screen"><div className="wrap">
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
    </div></div>
  );
}
