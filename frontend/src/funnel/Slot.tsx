import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFunnel } from './FunnelContext';
import type { SlotOption } from '../types';

export default function Slot() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [taken, setTaken] = useState(false);

  async function loadSlots() {
    const api = await import('../api');
    setSlots(await api.availableSlots());
  }

  useEffect(() => {
    if (!booking?.postcode) {
      navigate('/address');
      return;
    }
    void loadSlots();
  }, [booking, navigate]);

  async function pick(slotAt: string) {
    setTaken(false);
    const api = await import('../api');
    const ok = await api.holdSlot(slotAt);
    if (!ok) {
      setTaken(true);
      await loadSlots();
      return;
    }
    await refresh();
    navigate('/account');
  }

  function formatSlot(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="screen"><div className="wrap">
      <header className="head"><p className="eyebrow">Step 4 of 6</p><h1>Pick a delivery slot</h1></header>
      {taken && <p role="alert">That slot was just taken — please pick another.</p>}
      <div className="sizes">
        {slots.map((slot) => (
          <button
            key={slot.slotAt}
            className="size-btn"
            onClick={() => pick(slot.slotAt)}
          >
            {formatSlot(slot.slotAt)} · {slot.remaining} left
          </button>
        ))}
      </div>
      <p className="helper">We'll hold your slot for 10 minutes while you finish signing up.</p>
    </div></div>
  );
}
