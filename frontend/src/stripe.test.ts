import { describe, it, expect, afterEach, vi } from 'vitest';
import { stripePublishableKey } from './stripe';

afterEach(() => vi.unstubAllEnvs());

describe('stripePublishableKey', () => {
  it('throws when the key is missing', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');
    expect(() => stripePublishableKey()).toThrow(/missing|placeholder/i);
  });

  it('throws when the key is still the example placeholder', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_your_stripe_sandbox_publishable_key');
    expect(() => stripePublishableKey()).toThrow(/placeholder/i);
  });

  it('throws when the key is not a pk_ key', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'sk_live_oops');
    expect(() => stripePublishableKey()).toThrow(/pk_/i);
  });

  it('returns a real publishable key unchanged', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_realkey123');
    expect(stripePublishableKey()).toBe('pk_test_realkey123');
  });
});
