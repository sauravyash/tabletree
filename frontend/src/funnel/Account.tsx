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
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 5 of 6</p><h1>Create your account</h1></header>
      {secondsRemaining > 0 && <p role="status">Your delivery slot is held for {minutes}:{seconds}.</p>}
      <form onSubmit={onSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="add-btn" type="submit">Create account</button>
      </form>
    </div></div>
  );
}
