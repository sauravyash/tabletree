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
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 2 of 6</p><h1>What's your usual?</h1></header>
      <div className="sizes">
        {options.map((o) => (
          <button key={o} className="size-btn" aria-pressed={choice === o} onClick={() => setChoice(o)}>{o}</button>
        ))}
      </div>
      <button className="add-btn" onClick={onContinue}>Continue</button>
    </div></div>
  );
}
