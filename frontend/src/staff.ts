import type { Booking } from './types';

export type StaffTab = 'day' | 'week' | 'settings';

export interface StaffWeekBucket {
  key: string;
  label: string;
  bookings: Booking[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function bookingTime(b: Booking): number {
  if (!b.slotAt) return Number.POSITIVE_INFINITY;
  const t = new Date(b.slotAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function parseStaffTab(raw: string | null): StaffTab {
  return raw === 'week' || raw === 'settings' ? raw : 'day';
}

export function sortBookings(bookings: Booking[]): Booking[] {
  return [...bookings].sort((a, b) => {
    const diff = bookingTime(a) - bookingTime(b);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

export function deriveDefaultSelectedBookingId(bookings: Booking[], now = new Date()): string | undefined {
  const sorted = sortBookings(bookings);
  const nowTime = now.getTime();
  const timed = sorted.filter((b) => Number.isFinite(bookingTime(b)));
  if (timed.length > 0) {
    const upcoming = timed.find((b) => bookingTime(b) >= nowTime);
    return (upcoming ?? timed[timed.length - 1])?.id;
  }
  return sorted[0]?.id;
}

export function deriveNextSelectedBookingId(bookings: Booking[], removedId: string): string | undefined {
  const sorted = sortBookings(bookings);
  const idx = sorted.findIndex((b) => b.id === removedId);
  if (idx < 0) return deriveDefaultSelectedBookingId(sorted);
  return sorted[idx + 1]?.id ?? sorted[idx - 1]?.id;
}

export function groupDayBookings(bookings: Booking[], now = new Date()): { current: Booking[]; future: Booking[] } {
  const currentCutoff = startOfDay(new Date(now.getTime() + DAY_MS)).getTime();
  const sorted = sortBookings(bookings);
  return {
    current: sorted.filter((b) => !Number.isFinite(bookingTime(b)) || bookingTime(b) < currentCutoff),
    future: sorted.filter((b) => Number.isFinite(bookingTime(b)) && bookingTime(b) >= currentCutoff),
  };
}

export function buildWeekBuckets(bookings: Booking[], now = new Date()): {
  buckets: StaffWeekBucket[];
  later: Booking[];
  unscheduled: Booking[];
} {
  const start = startOfDay(now);
  const end = start.getTime() + DAY_MS * 7;
  const buckets: StaffWeekBucket[] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime() + DAY_MS * i);
    return {
      key: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      bookings: [],
    };
  });
  const later: Booking[] = [];
  const unscheduled: Booking[] = [];

  sortBookings(bookings).forEach((booking) => {
    const t = bookingTime(booking);
    if (!Number.isFinite(t)) {
      unscheduled.push(booking);
      return;
    }
    if (t >= start.getTime() && t < end) {
      const idx = Math.floor((t - start.getTime()) / DAY_MS);
      buckets[idx]?.bookings.push(booking);
      return;
    }
    later.push(booking);
  });

  return { buckets, later, unscheduled };
}

export function formatBookingDateLabel(slotAt: string | null): string {
  if (!slotAt) return 'Unscheduled';
  const d = new Date(slotAt);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatBookingTimeLabel(slotAt: string | null): string {
  if (!slotAt) return 'Flexible';
  const d = new Date(slotAt);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
