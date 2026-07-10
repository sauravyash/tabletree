import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from './stripe_real.ts';
import { runDeliver } from './deliver.ts';
import type { StripeGateway } from './stripe.ts';

Deno.serve(async (req) => {
  try {
    const { booking_id } = await req.json();
    if (!booking_id) return json({ error: 'missing_booking_id' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: booking, error: bErr } = await admin
      .from('bookings').select().eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);

    const { data: items } = await admin
      .from('booking_items').select('price_cents_snapshot,quantity').eq('booking_id', booking_id);

    // Lazily construct the real Stripe client only when a charge is actually needed,
    // so zero-amount deliveries don't require STRIPE_SECRET_KEY to be set.
    const gateway: StripeGateway = {
      charge: (args) => new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!).charge(args),
    };

    const result = await runDeliver({
      coffee: booking.coffee_price_cents,
      items: items ?? [],
      customer: booking.stripe_customer_id,
      paymentMethod: booking.stripe_payment_method_id,
    }, gateway);

    await admin.from('bookings')
      .update({ status: result.status, payment_intent_id: result.paymentIntentId ?? null })
      .eq('id', booking_id);

    return json(result, result.status === 'delivered' ? 200 : 402);
  } catch (_e) {
    return json({ error: 'bad_request' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
