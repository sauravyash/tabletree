import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from '../_shared/stripe_real.ts';
import { evaluateSetupIntent } from './confirm.ts';

Deno.serve(async (req) => {
  let booking_id: string | undefined, setup_intent_id: string | undefined;
  try { ({ booking_id, setup_intent_id } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (!booking_id || !setup_intent_id) return json({ error: 'missing_params' }, 400);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select('id,user_id,stripe_customer_id').eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    const stripe = new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const si = await stripe.retrieveSetupIntent(setup_intent_id);
    const result = evaluateSetupIntent(si, booking.stripe_customer_id);
    if (!result.ok) return json({ error: result.error }, 409);

    await admin.from('bookings').update({
      stripe_customer_id: result.customer,
      stripe_payment_method_id: result.paymentMethod,
    }).eq('id', booking.id);
    return json({ saved: true }, 200);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
