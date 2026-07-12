import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import CardSave from '../pages/CardSave';

export default function Card() {
  const navigate = useNavigate();
  const { booking } = useFunnel();

  useEffect(() => {
    if (!booking?.customerName) navigate('/account');
  }, [booking, navigate]);

  if (!booking) return null;

  async function onSaved() {
    const api = await import('../api');
    await api.finalizeDraftBooking();
    navigate('/bonus');
  }

  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 6 of 6</p><h1>Save a card for delivery day</h1></header>
      <p>You won't be charged now — we charge when your order is delivered.</p>
      <CardSave bookingId={booking.id} onSaved={onSaved} />
    </div></div>
  );
}
