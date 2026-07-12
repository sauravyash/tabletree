import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Booking, Product } from '../types';
import { ContinueBar } from '../components/ContinueBar';
import { flattenVariants, freeEligibleIds, variantLabel } from '../funnel/gift';

function loadApi() { return import('../api'); }

export default function Bonus() {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [giftItemId, setGiftItemId] = useState<string | null>(null);

  // Beverage buyers get a flower gift; flower buyers get a beverage gift. Legacy
  // bookings with no category default to the flower-gift path (original behaviour).
  const opposite: 'beverage' | 'flower' =
    booking?.purchaseCategory === 'flower' ? 'beverage' : 'flower';

  useEffect(() => {
    let cancelled = false;
    loadApi().then(async (api) => {
      const bk = await api.getMyBooking();
      if (cancelled || !bk) return;
      setBooking(bk);
      const opp: 'beverage' | 'flower' = bk.purchaseCategory === 'flower' ? 'beverage' : 'flower';
      const prods = await api.getProductsByCategory(opp);
      if (cancelled) return;
      setProducts(prods);
    });
    return () => { cancelled = true; };
  }, []);

  const eligible = freeEligibleIds(products, opposite);
  const rows = flattenVariants(products);

  async function addGift(variantId: string) {
    if (!booking) return;
    const api = await loadApi();
    const items = await api.getBookingItems(booking.id);
    await Promise.all(items.filter((i) => i.isGift).map((i) => api.removeBookingItem(i.id)));
    const item = await api.addBookingItem(booking.id, variantId, {}, 1, true);
    setGiftItemId(item.id);
  }

  const goToConfirmation = () => navigate('/confirmation');
  if (!booking) return null;

  const heading = opposite === 'flower'
    ? 'Add a flower to your order — on us'
    : 'Add a coffee to your order — on us';

  return (
    <>
      <div className="grain" />
      <div className="screen"><div className="wrap">
        <header className="head">
          <p className="eyebrow">A little something extra</p>
          <h1>{heading}</h1>
          <p>Our gift with your order — pick one, totally free.</p>
        </header>
        <div className="grid">
          {rows.map(({ product, variant }) => {
            const isEligible = eligible.has(variant.id);
            return (
              <div key={variant.id} className="gift-option">
                <span>{variantLabel(product, variant)}</span>
                {isEligible ? (
                  <button className="add-btn" onClick={() => addGift(variant.id)}>
                    {giftItemId ? 'Added' : `Add free gift — ${variantLabel(product, variant)}`}
                  </button>
                ) : (
                  <span className="gift-ineligible">Not part of the free gift</span>
                )}
              </div>
            );
          })}
        </div>
      </div></div>
      <ContinueBar count={giftItemId ? 1 : 0} onSkip={goToConfirmation} onContinue={goToConfirmation} />
    </>
  );
}
