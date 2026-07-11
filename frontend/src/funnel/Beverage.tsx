import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

type ApiModule = typeof import('../api');

export default function Beverage() {
  const navigate = useNavigate();
  const { booking } = useFunnel();
  const apiRef = useRef<ApiModule | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) {
      navigate('/');
      return;
    }

    let cancelled = false;
    import('../api').then(async (api) => {
      apiRef.current = api;
      const beverageOptions = await api.getConfigList('beverage_options');
      if (!cancelled) setOptions(beverageOptions);
    });

    return () => {
      cancelled = true;
    };
  }, [booking, navigate]);

  async function onContinue() {
    if (choice && apiRef.current) {
      await apiRef.current.setBeverage(choice);
    }
    navigate('/address');
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 2 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '33.333%' }} /></div>
        <h1>What's your usual?</h1>
        <p>Choose your go-to, or keep going and decide later.</p>
      </header>
      <section className="funnel-card beverage-card" aria-label="Choose a favourite beverage">
        <div className="beverage-grid">
          {options.map((o) => (
            <button key={o} className="beverage-option" aria-pressed={choice === o} onClick={() => setChoice(o)}>
              <span className="beverage-mark" aria-hidden="true">{o === 'Tea' ? '✦' : '☕'}</span>
              <span>{o}</span>
            </button>
          ))}
        </div>
        <button className="add-btn funnel-action" onClick={onContinue}>
          {choice ? `Continue with ${choice}` : 'Continue without choosing'}
        </button>
      </section>
    </div></div>
  );
}
