import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { useFunnel } from './FunnelContext';
import type { SlotOption } from '../types';

export default function Slot() {
  const navigate = useNavigate();
  const { booking, refresh } = useFunnel();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [taken, setTaken] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>();

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
  }, [booking?.postcode, navigate]);

  const availableDays = useMemo(() => {
    const seen = new Map<string, Date>();
    slots.forEach(({ slotAt }) => {
      const day = new Date(slotAt);
      day.setHours(0, 0, 0, 0);
      seen.set(day.toDateString(), day);
    });
    return [...seen.values()];
  }, [slots]);

  const activeDay = selectedDay ?? availableDays[0];
  const daySlots = useMemo(() => slots.filter((slot) => {
    if (!activeDay) return false;
    const day = new Date(slot.slotAt);
    return day.toDateString() === activeDay.toDateString();
  }), [activeDay, slots]);

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
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function periodFor(iso: string) {
    const hour = new Date(iso).getHours();
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  }

  const periods = ['Morning', 'Afternoon', 'Evening'] as const;

  return (
    <div className="screen slot-screen"><div className="wrap slot-wrap">
      <header className="head slot-head">
        <p className="eyebrow">Step 4 of 6</p>
        <div className="funnel-progress" aria-hidden="true"><span style={{ width: '66.667%' }} /></div>
        <h1>Pick a delivery slot</h1>
        <p>Choose a day, then a time that works for you.</p>
      </header>
      <section className="slot-picker" aria-label="Delivery slot picker">
        <div className="calendar-panel">
          <p className="slot-section-label">Choose a day</p>
          <DayPicker
            animate
            mode="single"
            selected={activeDay}
            onSelect={setSelectedDay}
            disabled={(date) => !availableDays.some((day) => day.toDateString() === date.toDateString())}
          />
        </div>
        <div className="times-panel">
          <p className="slot-section-label">Available times</p>
          {activeDay && <p className="selected-date">{activeDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
          {taken && <p role="alert">That slot was just taken — please pick another.</p>}
          {periods.map((period) => {
            const periodSlots = daySlots.filter((slot) => periodFor(slot.slotAt) === period);
            if (!periodSlots.length) return null;
            return <section key={period} className="time-period" aria-label={`${period} times`}>
              <h2>{period}</h2>
              <div className="time-grid">
                {periodSlots.map((slot) => (
                  <button key={slot.slotAt} className="time-option" onClick={() => pick(slot.slotAt)}>
                    <span>{formatSlot(slot.slotAt)}</span>
                    <small>{slot.remaining} {slot.remaining === 1 ? 'spot' : 'spots'} left</small>
                  </button>
                ))}
              </div>
            </section>;
          })}
          {!daySlots.length && <p className="helper">Choose an available day to see its delivery times.</p>}
        </div>
      </section>
      <p className="helper slot-helper">We’ll hold your chosen slot for 10 minutes while you finish signing up.</p>
    </div></div>
  );
}
