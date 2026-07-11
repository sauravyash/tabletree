import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Account() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const holdExpiresAt = booking?.holdExpiresAt ? new Date(booking.holdExpiresAt).getTime() : null;
  const secondsRemaining = holdExpiresAt === null ? 0 : Math.max(0, Math.ceil((holdExpiresAt - now) / 1000));

  useEffect(() => {
    if (secondsRemaining === 0) {
      navigate('/slot');
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [navigate, secondsRemaining]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = String(secondsRemaining % 60).padStart(2, '0');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const api = await import('../api');
      await api.upgradeAccount(email, password);
      await api.setCustomer(name);
      await refresh();
      navigate('/card');
    } catch (err) {
      const message = (err as Error).message ?? '';
      setError(/already|use|registered/i.test(message)
        ? 'That email is already registered — try another.'
        : 'Could not create your account. Please try again.');
    }
  }

  return (
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 5 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '83.333%' }} /></div>
        <h1>Create your account</h1>
        <p>Save your details so we can keep your delivery on track.</p>
      </header>
      <form className="funnel-card account-form" onSubmit={onSubmit}>
        {secondsRemaining > 0 && <p className="hold-status" role="status"><span aria-hidden="true">◷</span> Your delivery slot is held for <strong>{minutes}:{seconds}</strong>.</p>}
        <label>
          Name
          <input placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="add-btn funnel-action" type="submit">Create account</button>
      </form>
    </div></div>
  );
}
