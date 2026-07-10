import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { computeCharge, runDeliver } from './deliver.ts';
import type { StripeGateway } from './stripe.ts';

Deno.test('computeCharge sums coffee + floral snapshots', () => {
  assertEquals(
    computeCharge(500, [
      { price_cents_snapshot: 3800, quantity: 1 },
      { price_cents_snapshot: 6500, quantity: 2 },
    ]),
    500 + 3800 + 13000,
  );
});

Deno.test('computeCharge treats null coffee price as zero', () => {
  assertEquals(computeCharge(null, [{ price_cents_snapshot: 3800, quantity: 1 }]), 3800);
});

function fakeGateway(behavior: 'ok' | 'decline'): StripeGateway {
  return {
    charge() {
      if (behavior === 'decline') {
        const e = new Error('declined') as Error & { code?: string };
        e.code = 'card_declined';
        throw e;
      }
      return Promise.resolve({ id: 'pi_test_1' });
    },
  };
}

Deno.test('runDeliver returns delivered + payment id on success', async () => {
  const r = await runDeliver(
    { coffee: 500, items: [{ price_cents_snapshot: 3800, quantity: 1 }], customer: 'cus', paymentMethod: 'pm' },
    fakeGateway('ok'),
  );
  assertEquals(r.status, 'delivered');
  assertEquals(r.paymentIntentId, 'pi_test_1');
});

Deno.test('runDeliver returns payment_failed on card decline', async () => {
  const r = await runDeliver(
    { coffee: 500, items: [{ price_cents_snapshot: 3800, quantity: 1 }], customer: 'cus', paymentMethod: 'pm' },
    fakeGateway('decline'),
  );
  assertEquals(r.status, 'payment_failed');
  assertEquals(r.error, 'card_declined');
});

Deno.test('runDeliver skips charge when amount is zero', async () => {
  let called = false;
  const g: StripeGateway = {
    charge() {
      called = true;
      return Promise.resolve({ id: 'x' });
    },
  };
  const r = await runDeliver({ coffee: null, items: [], customer: 'cus', paymentMethod: 'pm' }, g);
  assertEquals(r.status, 'delivered');
  assertEquals(called, false);
});
