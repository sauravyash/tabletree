import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setPurchaseCategory } from '../api';
import { useFunnel } from './FunnelContext';

export default function Choose() {
  const navigate = useNavigate();
  const { booking } = useFunnel();

  useEffect(() => { if (!booking) navigate('/'); }, [booking, navigate]);

  async function pick(category: 'beverage' | 'flower') {
    await setPurchaseCategory(category);
    navigate(category === 'beverage' ? '/beverage' : '/flower');
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 2 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '33.333%' }} /></div>
        <h1>What are you here for?</h1>
        <p>Pick one to buy — the other comes free as a gift.</p>
      </header>
      <section className="funnel-card" aria-label="Choose a category">
        <div className="beverage-grid">
          <button className="beverage-option" onClick={() => pick('beverage')}>
            <span className="beverage-mark" aria-hidden="true">☕</span>
            <span>A beverage</span>
          </button>
          <button className="beverage-option" onClick={() => pick('flower')}>
            <span className="beverage-mark" aria-hidden="true">✿</span>
            <span>A flower</span>
          </button>
        </div>
      </section>
    </div></div>
  );
}
