import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setBookingWish, startDraftBooking } from '../api';
import { useFunnel } from './FunnelContext';

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useFunnel();
  const initialized = useRef(false);
  const [wish, setWish] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishSaved, setWishSaved] = useState(false);
  const [wishLaunched, setWishLaunched] = useState(false);
  const storeCode = params.get('store');

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let cancelled = false;
    (async () => {
      await startDraftBooking(storeCode);
      if (!cancelled) {
        await refresh();
        setDraftReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storeCode, refresh]);

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
        {wishError && <p role="alert">{wishError}</p>}
        {wishSaved && <p className="wish-saved" role="status">Wish saved</p>}
        <button className="add-btn landing-action" onClick={start} disabled={saving || !draftReady}>
          {saving ? 'Saving your wish…' : draftReady ? 'Get started' : 'Preparing your delivery…'}
        </button>
      </section>
    </div></div>
  );
}
