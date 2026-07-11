import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Account() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const holdIsLive = booking?.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() > Date.now();
    if (!holdIsLive) navigate('/slot');
  }, [booking, navigate]);

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
