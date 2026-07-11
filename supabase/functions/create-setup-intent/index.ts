import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RealStripe } from '../_shared/stripe_real.ts';
import { resolveCustomer } from './setup.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const cors = corsHeaders(req);
  let booking_id: string | undefined;
  try { ({ booking_id } = await req.json()); } catch { return json({ error: 'bad_request' }, 400, cors); }
  if (!booking_id) return json({ error: 'missing_booking_id' }, 400, cors);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'unauthorized' }, 401, cors);

    const { data: booking, error: bErr } = await admin
      .from('bookings').select('id,user_id,email,stripe_customer_id').eq('id', booking_id).single();
    if (bErr || !booking) return json({ error: 'booking_not_found' }, 404, cors);
    if (booking.user_id !== user.id) return json({ error: 'forbidden' }, 403, cors);

    const stripe = new RealStripe(Deno.env.get('STRIPE_SECRET_KEY')!);
    const { customerId, created } = await resolveCustomer(booking, stripe);
    if (created) {
      await admin.from('bookings').update({ stripe_customer_id: customerId }).eq('id', booking.id);
    }
    const si = await stripe.createSetupIntent({ customer: customerId });
    return json({ clientSecret: si.clientSecret }, 200, cors);
  } catch (_e) {
    return json({ error: 'internal_error' }, 500, cors);
  }
});

function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });
}
