import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from '../_shared/stripe_real.ts';
import { runDeliver } from './deliver.ts';
import type { StripeGateway } from '../_shared/stripe.ts';
import { authorize } from './authz.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Parse request (client error on bad body).
  let booking_id: string | undefined;
  try {
    ({ booking_id } = await req.json());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!booking_id) return json({ error: 'missing_booking_id' }, 400);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Authenticate the caller from their JWT. The public anon key is a valid
    // project JWT but has no user, so this rejects anon-key-only invocations.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select().eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);

    // Delivery/charge is allowed for the booking owner OR a staff member.
    const { data: staffRow } = await admin
      .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'staff').maybeSingle();
    if (!authorize(booking, user.id, !!staffRow)) return json({ error: 'forbidden' }, 403);

    // Idempotency: never charge an already-delivered booking again.
    if (booking.status === 'delivered') {
      return json({ status: 'delivered', paymentIntentId: booking.payment_intent_id ?? undefined }, 200);
    }

    const { data: items } = await admin
      .from('booking_items').select('price_cents_snapshot,quantity').eq('booking_id', booking_id);

    // Construct the real Stripe client lazily, only when a charge is needed,
    // so zero-amount deliveries don't require STRIPE_SECRET_KEY.
    const gateway: StripeGateway = {
      charge: (args) => new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!).charge(args),
      createCustomer: (args) => new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!).createCustomer(args),
      createSetupIntent: (args) => new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!).createSetupIntent(args),
      retrieveSetupIntent: (id) => new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!).retrieveSetupIntent(id),
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

    // Both 'delivered' and 'payment_failed' are business outcomes of a successful
    // request; the caller reads result.status. Reserve non-2xx for actual errors.
    return json(result, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } });
}
