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
    <div className="screen funnel-screen"><div className="wrap funnel-wrap">
      <header className="head funnel-head">
        <p className="eyebrow">Step 3 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '50%' }} /></div>
        <h1>Where should we deliver?</h1>
        <p>We’ll check that your address is in our delivery area.</p>
      </header>
      <form className="funnel-card address-form" onSubmit={onSubmit}>
        <label>
          Address line 1
          <input placeholder="12 Smith Street" autoComplete="address-line1" value={line1} onChange={(e) => setLine1(e.target.value)} required />
        </label>
        <label>
          Apartment, suite, etc. <span className="optional">Optional</span>
          <input placeholder="Apartment 4" autoComplete="address-line2" value={line2} onChange={(e) => setLine2(e.target.value)} />
        </label>
        <label className="field-half">
          Suburb
          <input placeholder="Alexandria" autoComplete="address-level2" value={suburb} onChange={(e) => setSuburb(e.target.value)} required />
        </label>
        <label className="field-half">
          Postcode
          <input placeholder="2015" autoComplete="postal-code" inputMode="numeric" maxLength={4} value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
        </label>
        {outOfRange && <p role="alert">Sorry — that's not in our delivery area yet.</p>}
        <button className="add-btn funnel-action" type="submit">Check delivery area &amp; continue</button>
      </form>
    </div></div>
  );
}
