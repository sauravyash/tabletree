import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useFunnel();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = await import('../api');
      await api.startDraftBooking(params.get('store'));
      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; };
  }, [params, refresh]);
  return (
    <div className="screen"><div className="wrap">
      <header className="head">
        <p className="eyebrow">Fresh flowers with your coffee</p>
        <h1>Let's set up your delivery</h1>
        <p>A few quick steps and your first Table Tree is on its way.</p>
      </header>
      <button className="add-btn" onClick={() => navigate('/beverage')}>Get started</button>
    </div></div>
  );
}
