import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

export default function Address() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState('');
  const [outOfRange, setOutOfRange] = useState(false);

  useEffect(() => {
    if (!booking) navigate('/');
  }, [booking, navigate]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOutOfRange(false);
    const api = await import('../api');
    const ok = await api.setAddress({ line1, line2, suburb, postcode });
    if (!ok) {
      setOutOfRange(true);
      return;
    }
    await refresh();
    navigate('/slot');
  }

  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 3 of 6</p><h1>Where should we deliver?</h1></header>
      <form onSubmit={onSubmit}>
        <label>
          Address line 1
          <input value={line1} onChange={(e) => setLine1(e.target.value)} required />
        </label>
        <label>
          Address line 2
          <input value={line2} onChange={(e) => setLine2(e.target.value)} />
        </label>
        <label>
          Suburb
          <input value={suburb} onChange={(e) => setSuburb(e.target.value)} required />
        </label>
        <label>
          Postcode
          <input value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
        </label>
        {outOfRange && <p role="alert">Sorry — that's not in our delivery area yet.</p>}
        <button className="add-btn" type="submit">Continue</button>
      </form>
    </div></div>
  );
}
