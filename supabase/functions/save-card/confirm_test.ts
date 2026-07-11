import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evaluateSetupIntent } from './confirm.ts';

const ok = { status: 'succeeded', customer: 'cus_1', paymentMethod: 'pm_1' };

Deno.test('accepts a succeeded intent for the expected customer', () => {
  assertEquals(evaluateSetupIntent(ok, 'cus_1'), { ok: true, customer: 'cus_1', paymentMethod: 'pm_1' });
});
Deno.test('rejects a non-succeeded intent', () => {
  assertEquals(evaluateSetupIntent({ ...ok, status: 'requires_action' }, 'cus_1'),
    { ok: false, error: 'setup_not_succeeded' });
});
Deno.test('rejects a customer mismatch', () => {
  assertEquals(evaluateSetupIntent(ok, 'cus_other'), { ok: false, error: 'customer_mismatch' });
});
Deno.test('rejects a missing payment method', () => {
  assertEquals(evaluateSetupIntent({ ...ok, paymentMethod: '' }, 'cus_1'),
    { ok: false, error: 'no_payment_method' });
});
Deno.test('rejects a succeeded intent when the booking has no expected customer', () => {
  assertEquals(evaluateSetupIntent(ok, null), { ok: false, error: 'customer_mismatch' });
});
