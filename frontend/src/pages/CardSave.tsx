import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createSetupIntent, saveCard } from '../api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CardForm({
  bookingId,
  onSaved,
}: {
  bookingId: string;
  onSaved?: (id: string) => void | Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || working) return;
    setWorking(true); setError(null);
    const { error: confErr, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    if (confErr || !setupIntent || setupIntent.status !== 'succeeded') {
      setError(confErr?.message ?? 'Could not save the card.'); setWorking(false); return;
    }
    try {
      await saveCard(bookingId, setupIntent.id);
      if (onSaved) {
        await onSaved(bookingId);
      } else {
        navigate('/');
      }
    } catch {
      setError('Card confirmed but saving failed. Please try again.'); setWorking(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      <button type="submit" disabled={working}>{working ? 'Saving…' : 'Save card'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export default function CardSave({
  bookingId,
  onSaved,
}: {
  bookingId: string;
  onSaved?: (id: string) => void | Promise<void>;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createSetupIntent(bookingId)
      .then((r) => { if (!cancelled) setClientSecret(r.clientSecret); })
      .catch(() => { if (!cancelled) setError('Could not start card setup.'); });
    return () => { cancelled = true; };
  }, [bookingId]);

  const options = useMemo(() => (clientSecret ? { clientSecret } : undefined), [clientSecret]);

  return (
    <div className="screen"><div className="wrap">
      <h1>Save a card for your delivery</h1>
      {error && <p role="alert">{error}</p>}
      {options && (
        <Elements stripe={stripePromise} options={options}>
          <CardForm bookingId={bookingId} onSaved={onSaved} />
        </Elements>
      )}
    </div></div>
  );
}
