import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DraftBooking } from '../types';

interface FunnelValue { booking: DraftBooking | null; loading: boolean; refresh: () => Promise<void>; }
const FunnelCtx = createContext<FunnelValue | null>(null);

export function useFunnel(): FunnelValue {
  const v = useContext(FunnelCtx);
  if (!v) throw new Error('useFunnel must be used within FunnelProvider');
  return v;
}

export function FunnelProvider({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<DraftBooking | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() { const api = await import('../api'); setBooking(await api.getMyDraftBooking()); }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = await import('../api');
        await api.ensureAnonSession();
        const b = await api.getMyDraftBooking();
        if (!cancelled) setBooking(b);
      } catch {
        if (!cancelled) setBooking(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return <FunnelCtx.Provider value={{ booking, loading, refresh }}>{children}</FunnelCtx.Provider>;
}
