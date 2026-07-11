import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveCustomer } from './setup.ts';

Deno.test('reuses an existing customer', async () => {
  let called = false;
  const g = { createCustomer() { called = true; return Promise.resolve({ id: 'cus_new' }); } };
  const r = await resolveCustomer({ stripe_customer_id: 'cus_old', email: 'a@x' }, g);
  assertEquals(r, { customerId: 'cus_old', created: false });
  assertEquals(called, false);
});

Deno.test('creates a customer when none exists', async () => {
  const g = { createCustomer(args: { email: string | null }) { return Promise.resolve({ id: 'cus_' + args.email }); } };
  const r = await resolveCustomer({ stripe_customer_id: null, email: 'a@x' }, g);
  assertEquals(r, { customerId: 'cus_a@x', created: true });
});
