import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setBookingWish, startDraftBooking } from '../api';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loading, refresh } = useFunnel();
  const initialized = useRef(false);
  const resetTimer = useRef<number | null>(null);
  const [wish, setWish] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishLaunched, setWishLaunched] = useState(false);
  const storeCode = params.get('store');

  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    let cancelled = false;
    (async () => {
      try {
        await startDraftBooking(storeCode);
        await refresh();
        if (!cancelled) { setDraftReady(true); setSetupError(null); }
      } catch {
        if (!cancelled) setSetupError('We couldn’t get things ready. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [loading, setupAttempt, storeCode, refresh]);

  useEffect(() => () => { if (resetTimer.current) window.clearTimeout(resetTimer.current); }, []);

  function retrySetup() {
    initialized.current = false;
    setSetupError(null);
    setSetupAttempt((attempt) => attempt + 1);
  }

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = wish.trim();
    if (!value || !draftReady || saving) return;
    setSaving(true);
    setWishError(null);
    try {
      await setBookingWish(value);
      await refresh();
      setWish('');
      setWishLaunched(true);
      resetTimer.current = window.setTimeout(() => setWishLaunched(false), 2200);
    } catch {
      setWishError('We couldn’t send that. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen koslist-screen"><div className="koslist-wrap">
      <p className="eyebrow koslist-eyebrow">Everything, arranged</p>
      <h1 className="koslist-wordmark">KosList<span className="koslist-dot">.</span>au</h1>

      <nav className="koslist-chips" aria-label="Categories">
        <button type="button" className="koslist-chip" onClick={() => navigate('/jobs')}>Jobs</button>
        <button type="button" className="koslist-chip" onClick={() => navigate('/cowork')}>Co-work</button>
        <button type="button" className="koslist-chip" disabled aria-disabled="true">Manifestables</button>
      </nav>

      {!wishLaunched ? (
        <form className="koslist-ask" onSubmit={onAsk}>
          <span className="koslist-ask-icon" aria-hidden="true">✦</span>
          <input
            aria-label="Ask me anything"
            maxLength={500}
            placeholder="ask me anything…"
            value={wish}
            onChange={(event) => setWish(event.target.value)}
          />
        </form>
      ) : (
        <div className="koslist-ask koslist-ask--launch wish-launch" aria-live="polite">
          <span className="shooting-star" aria-hidden="true" />
          <span>Wish sent</span>
        </div>
      )}
      {setupError && <p className="koslist-error" role="alert">{setupError} <button type="button" onClick={retrySetup}>Retry</button></p>}
      {wishError && <p className="koslist-error" role="alert">{wishError}</p>}

      <div className="koslist-cards">
        <div className="koslist-card koslist-card--inert" aria-disabled="true">Keyboard</div>
        <button type="button" className="koslist-card koslist-card--active" onClick={() => navigate('/beverage')}>KosKup</button>
        <div className="koslist-card koslist-card--inert" aria-disabled="true">RoundTable</div>
      </div>
    </div></div>
  );
}
