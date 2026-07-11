import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setBookingWish, startDraftBooking } from '../api';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loading, refresh } = useFunnel();
  const initialized = useRef(false);
  const [wish, setWish] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishSaved, setWishSaved] = useState(false);
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
        if (!cancelled) {
          setDraftReady(true);
          setSetupError(null);
        }
      } catch {
        if (!cancelled) {
          setSetupError('We couldn’t prepare your delivery. Please try again.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loading, setupAttempt, storeCode, refresh]);

  function retrySetup() {
    initialized.current = false;
    setSetupError(null);
    setSetupAttempt((attempt) => attempt + 1);
  }

  async function saveWish(): Promise<boolean> {
    const value = wish.trim();
    if (!value) return true;
    setSaving(true);
    setWishError(null);
    try {
      await setBookingWish(value);
      await refresh();
      setWishSaved(true);
      return true;
    } catch {
      setWishError('We couldn’t save your wish. Please try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onWishSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await saveWish()) setWishLaunched(true);
  }

  async function start() {
    if (await saveWish()) navigate('/beverage');
  }

  return (
    <div className="screen landing-screen"><div className="wrap landing-wrap">
      <header className="head landing-head">
        <p className="eyebrow">Fresh flowers with your coffee</p>
        <h1>Let's set up your delivery</h1>
        <p>A few quick steps and your first Table Tree is on its way.</p>
      </header>
      <section className="landing-card" aria-label="Tell us your wish">
        <p className="wish-kicker">A little something extra</p>
        <h2>What are you wishing for?</h2>
        <p>Share a thought, a feeling, or a moment you’d like us to bring to life.</p>
        {!wishLaunched ? (
          <form className="wish-composer" onSubmit={onWishSubmit}>
            <input
              aria-label="Make a wish"
              maxLength={500}
              placeholder="Make a wish"
              value={wish}
              onChange={(event) => { setWish(event.target.value); setWishSaved(false); }}
            />
            <button type="submit" aria-label="Save wish" disabled={saving || !draftReady || !wish.trim()}>↑</button>
          </form>
        ) : (
          <div className="wish-launch" aria-live="polite">
            <span className="shooting-star" aria-hidden="true" />
            <span>Wish sent</span>
          </div>
        )}
        {setupError && <p className="landing-setup-error" role="alert">{setupError} <button type="button" onClick={retrySetup}>Retry</button></p>}
        {wishError && <p role="alert">{wishError}</p>}
        {wishSaved && <p className="wish-saved" role="status">Wish saved</p>}
        <button className="add-btn landing-action" onClick={start} disabled={saving || !draftReady}>
          {saving ? 'Saving your wish…' : draftReady ? 'Get started' : 'Preparing your delivery…'}
        </button>
      </section>
    </div></div>
  );
}
