import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { deliverBooking, getBookingItems, getProducts, listPendingBookings } from '../api';
import { formatPrice } from '../money';
import {
  buildWeekBuckets,
  deriveDefaultSelectedBookingId,
  deriveNextSelectedBookingId,
  formatBookingDateLabel,
  formatBookingTimeLabel,
  groupDayBookings,
  parseStaffTab,
  sortBookings,
  type StaffTab,
} from '../staff';
import { supabase } from '../supabase';
import type { Booking, BookingItem, StaffProfile, Variant } from '../types';

type VariantLookup = Map<string, { v: Variant; product: string }>;

function emptyProfile(): StaffProfile {
  return { displayName: '', phone: '', avatarUrl: '', email: '' };
}

function profileFromUser(user: User | null | undefined): StaffProfile {
  const data = user?.user_metadata ?? {};
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
    email: user?.email ?? '',
  };
}

async function currentStaffSession(): Promise<{ isStaff: boolean; session: Session | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { isStaff: false, session: null };
  const { data } = await supabase.from('user_roles')
    .select('role').eq('user_id', session.user.id).eq('role', 'staff').maybeSingle();
  return { isStaff: !!data, session };
}

function BookingBlock({
  booking,
  selected,
  onSelect,
}: {
  booking: Booking;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`staff-booking-block${selected ? ' active' : ''}`}
      onClick={() => onSelect(booking.id)}
      aria-pressed={selected}
    >
      <span className="staff-booking-time">{formatBookingTimeLabel(booking.slotAt)}</span>
      <strong>{booking.customerName ?? booking.id.slice(0, 8)}</strong>
      <span>{booking.status}</span>
      <span>{formatPrice(booking.coffeePriceCents ?? 0, 'sample')}</span>
    </button>
  );
}

function BookingColumn({
  title,
  bookings,
  selectedBookingId,
  onSelect,
  empty,
}: {
  title: string;
  bookings: Booking[];
  selectedBookingId?: string;
  onSelect: (id: string) => void;
  empty: string;
}) {
  return (
    <section className="staff-board-section">
      <div className="staff-section-head">
        <h2>{title}</h2>
        <span>{bookings.length}</span>
      </div>
      {bookings.length === 0 ? (
        <p className="staff-empty">{empty}</p>
      ) : (
        <div className="staff-block-stack">
          {bookings.map((booking) => (
            <BookingBlock
              key={booking.id}
              booking={booking}
              selected={booking.id === selectedBookingId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BookingDetail({
  booking,
  items,
  itemsLoaded,
  variants,
  working,
  error,
  onDeliver,
}: {
  booking: Booking | null;
  items: BookingItem[];
  itemsLoaded: boolean;
  variants: VariantLookup;
  working: boolean;
  error: string | null;
  onDeliver: () => void;
}) {
  if (!booking) {
    return (
      <aside className="staff-detail-panel">
        <h2>Booking details</h2>
        <p className="staff-empty">Select a booking to inspect and deliver it.</p>
      </aside>
    );
  }

  return (
    <aside className="staff-detail-panel">
      <div className="staff-detail-top">
        <div>
          <p className="eyebrow">Selected booking</p>
          <h2>{booking.customerName ?? booking.id.slice(0, 8)}</h2>
        </div>
        <span className={`staff-status-chip status-${booking.status}`}>{booking.status}</span>
      </div>
      <dl className="staff-meta">
        <div>
          <dt>Date</dt>
          <dd>{formatBookingDateLabel(booking.slotAt)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatBookingTimeLabel(booking.slotAt)}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{booking.email ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Coffee</dt>
          <dd>{formatPrice(booking.coffeePriceCents ?? 0, 'sample')}</dd>
        </div>
      </dl>
      <section>
        <div className="staff-section-head">
          <h3>Floral items</h3>
          <span>{items.length}</span>
        </div>
        {!itemsLoaded ? (
          <p className="staff-empty">Loading booking items…</p>
        ) : items.length === 0 ? (
          <p className="staff-empty">No floral items for this booking.</p>
        ) : (
          <ul className="staff-item-list">
            {items.map((item) => {
              const info = variants.get(item.variantId);
              const handle = item.optionSnapshot.handle ? ` · handle: ${item.optionSnapshot.handle}` : '';
              return (
                <li key={item.id}>
                  {info?.product ?? 'Floral item'} — {info?.v.size ?? '—'}
                  {handle} × {item.quantity}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {booking.status !== 'delivered' && (
        <button className="staff-primary-btn" onClick={onDeliver} disabled={working}>
          {working ? 'Delivering…' : 'Mark delivered'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}

function SettingsPanel({
  profile,
  saving,
  error,
  saved,
  onChange,
  onSave,
}: {
  profile: StaffProfile;
  saving: boolean;
  error: string | null;
  saved: boolean;
  onChange: (field: keyof StaffProfile, value: string) => void;
  onSave: (e: React.FormEvent) => void;
}) {
  return (
    <section className="staff-settings-card">
      <div className="staff-section-head">
        <h2>Personal details</h2>
        <span>Profile</span>
      </div>
      <form className="staff-settings-form" onSubmit={onSave}>
        <label>
          Display name
          <input
            type="text"
            value={profile.displayName}
            onChange={(e) => onChange('displayName', e.target.value)}
          />
        </label>
        <label>
          Mobile number
          <input
            type="tel"
            value={profile.phone}
            onChange={(e) => onChange('phone', e.target.value)}
          />
        </label>
        <label>
          Avatar URL
          <input
            type="url"
            value={profile.avatarUrl}
            onChange={(e) => onChange('avatarUrl', e.target.value)}
          />
        </label>
        <label>
          Email
          <input type="email" value={profile.email} readOnly />
        </label>
        <button className="staff-primary-btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && !error && <p>Settings saved.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}

export default function StaffBookings() {
  const navigate = useNavigate();
  const { bookingId: routeBookingId } = useParams<{ bookingId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [variants, setVariants] = useState<VariantLookup>(new Map());
  const [itemsByBooking, setItemsByBooking] = useState<Record<string, BookingItem[]>>({});
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliveryWorking, setDeliveryWorking] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<StaffProfile>(emptyProfile());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const activeTab = parseStaffTab(searchParams.get('tab'));
  const selectedBookingId = searchParams.get('booking') ?? undefined;
  const selectedBooking = useMemo(
    () => sortBookings(bookings).find((booking) => booking.id === selectedBookingId) ?? null,
    [bookings, selectedBookingId],
  );
  const dayGroups = useMemo(() => groupDayBookings(bookings), [bookings]);
  const weekGroups = useMemo(() => buildWeekBuckets(bookings), [bookings]);
  const sortedBookings = useMemo(() => sortBookings(bookings), [bookings]);
  const selectedItems = selectedBookingId ? itemsByBooking[selectedBookingId] ?? [] : [];
  const selectedItemsLoaded = !!(selectedBookingId && Object.prototype.hasOwnProperty.call(itemsByBooking, selectedBookingId));

  function updateWorkspaceParams(next: { tab?: StaffTab; booking?: string | null }, replace = false) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next.tab !== undefined) params.set('tab', next.tab);
      if (next.booking) params.set('booking', next.booking);
      else if (next.booking === null) params.delete('booking');
      return params;
    }, { replace });
  }

  async function refresh() {
    setLoadingWorkspace(true);
    setPageError(null);
    const { isStaff: staff, session } = await currentStaffSession();
    setIsStaff(staff);
    setProfile(profileFromUser(session?.user));
    if (!staff) {
      setLoadingWorkspace(false);
      return;
    }
    try {
      const [nextBookings, products] = await Promise.all([
        listPendingBookings(),
        getProducts(),
      ]);
      const lookup: VariantLookup = new Map();
      products.forEach((product) => {
        product.variants.forEach((variant) => {
          lookup.set(variant.id, { v: variant, product: product.name });
        });
      });
      setBookings(nextBookings);
      setVariants(lookup);
    } catch {
      setPageError('Could not load the staff calendar.');
    } finally {
      setLoadingWorkspace(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!routeBookingId) return;
    const params = new URLSearchParams(searchParams);
    if (!params.get('booking')) params.set('booking', routeBookingId);
    navigate({ pathname: '/staff', search: `?${params.toString()}` }, { replace: true });
  }, [navigate, routeBookingId, searchParams]);

  useEffect(() => {
    if (!isStaff || activeTab === 'settings') return;
    if (sortedBookings.length === 0) {
      if (selectedBookingId) updateWorkspaceParams({ booking: null }, true);
      return;
    }
    if (selectedBookingId && sortedBookings.some((booking) => booking.id === selectedBookingId)) return;
    updateWorkspaceParams({ booking: deriveDefaultSelectedBookingId(sortedBookings) ?? null }, true);
  }, [activeTab, isStaff, selectedBookingId, sortedBookings]);

  useEffect(() => {
    if (!selectedBookingId || activeTab === 'settings') return;
    if (Object.prototype.hasOwnProperty.call(itemsByBooking, selectedBookingId)) return;
    let cancelled = false;
    Promise.resolve(getBookingItems(selectedBookingId))
      .then((items) => {
        if (cancelled) return;
        setItemsByBooking((prev) => ({ ...prev, [selectedBookingId]: items }));
      })
      .catch(() => {
        if (cancelled) return;
        setItemsByBooking((prev) => ({ ...prev, [selectedBookingId]: [] }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, itemsByBooking, selectedBookingId]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setPageError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setPageError('Sign-in failed.');
      return;
    }
    await refresh();
  }

  async function markDelivered() {
    if (!selectedBooking || deliveryWorking) return;
    setDeliveryWorking(true);
    setDeliveryError(null);
    try {
      const res = await deliverBooking(selectedBooking.id);
      if (res.status === 'delivered') {
        const removedId = selectedBooking.id;
        const nextBookingId = deriveNextSelectedBookingId(sortedBookings, removedId);
        setBookings((prev) => prev.filter((booking) => booking.id !== removedId));
        setItemsByBooking((prev) => {
          const next = { ...prev };
          delete next[removedId];
          return next;
        });
        updateWorkspaceParams({ booking: nextBookingId ?? null }, true);
      } else {
        setBookings((prev) => prev.map((booking) => (
          booking.id === selectedBooking.id ? { ...booking, status: res.status } : booking
        )));
        if (res.status === 'payment_failed') {
          setDeliveryError('Charge failed — the card was not charged. Payment method may need attention.');
        }
      }
    } catch {
      setDeliveryError('Could not reach the delivery service. Please try again.');
    } finally {
      setDeliveryWorking(false);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsSaved(false);
    setSettingsError(null);
    const { data, error } = await supabase.auth.updateUser({
      data: {
        displayName: profile.displayName,
        phone: profile.phone,
        avatarUrl: profile.avatarUrl,
      },
    });
    if (error) {
      setSettingsError('Could not save settings.');
      setSettingsSaving(false);
      return;
    }
    setProfile(profileFromUser(data.user));
    setSettingsSaving(false);
    setSettingsSaved(true);
  }

  function handleSelectBooking(id: string) {
    setDeliveryError(null);
    updateWorkspaceParams({ booking: id }, false);
  }

  function changeTab(tab: StaffTab) {
    updateWorkspaceParams({ tab }, false);
  }

  if (isStaff === null) return null;

  if (!isStaff) {
    return (
      <div className="screen">
        <div className="wrap">
          <div className="staff-shell">
            <h1>Staff sign-in</h1>
            {pageError && <p role="alert">{pageError}</p>}
            <form className="staff-signin-form" onSubmit={signIn}>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <button className="staff-primary-btn" type="submit">Sign in</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="wrap">
        <div className="staff-shell">
          <header className="staff-toolbar">
            <div>
              <p className="eyebrow">Staff workspace</p>
              <h1>Delivery calendar</h1>
            </div>
            <nav className="staff-tabs" aria-label="Staff tabs">
              {(['day', 'week', 'settings'] as StaffTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`staff-tab${activeTab === tab ? ' active' : ''}`}
                  onClick={() => changeTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </nav>
          </header>

          {pageError && <p role="alert">{pageError}</p>}

          {activeTab === 'settings' ? (
            <SettingsPanel
              profile={profile}
              saving={settingsSaving}
              error={settingsError}
              saved={settingsSaved}
              onChange={(field, value) => {
                setSettingsSaved(false);
                setProfile((prev) => ({ ...prev, [field]: value }));
              }}
              onSave={saveSettings}
            />
          ) : (
            <div className="staff-workspace">
              <section className="staff-board">
                {activeTab === 'day' ? (
                  <>
                    <BookingColumn
                      title="Today & current"
                      bookings={dayGroups.current}
                      selectedBookingId={selectedBookingId}
                      onSelect={handleSelectBooking}
                      empty={loadingWorkspace ? 'Loading bookings…' : 'No current bookings.'}
                    />
                    <BookingColumn
                      title="Future"
                      bookings={dayGroups.future}
                      selectedBookingId={selectedBookingId}
                      onSelect={handleSelectBooking}
                      empty="No future bookings."
                    />
                  </>
                ) : (
                  <>
                    <section className="staff-board-section">
                      <div className="staff-section-head">
                        <h2>Week view</h2>
                        <span>{sortedBookings.length}</span>
                      </div>
                      <div className="staff-week-grid">
                        {weekGroups.buckets.map((bucket) => (
                          <div key={bucket.key} className="staff-week-day">
                            <div className="staff-week-label">{bucket.label}</div>
                            <div className="staff-block-stack">
                              {bucket.bookings.length === 0 ? (
                                <p className="staff-empty">No bookings</p>
                              ) : (
                                bucket.bookings.map((booking) => (
                                  <BookingBlock
                                    key={booking.id}
                                    booking={booking}
                                    selected={booking.id === selectedBookingId}
                                    onSelect={handleSelectBooking}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <BookingColumn
                      title="Later"
                      bookings={weekGroups.later}
                      selectedBookingId={selectedBookingId}
                      onSelect={handleSelectBooking}
                      empty="Nothing beyond this week."
                    />
                    <BookingColumn
                      title="Unscheduled"
                      bookings={weekGroups.unscheduled}
                      selectedBookingId={selectedBookingId}
                      onSelect={handleSelectBooking}
                      empty="No unscheduled bookings."
                    />
                  </>
                )}
              </section>
              <BookingDetail
                booking={selectedBooking}
                items={selectedItems}
                itemsLoaded={selectedItemsLoaded}
                variants={variants}
                working={deliveryWorking}
                error={deliveryError}
                onDeliver={markDelivered}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
