// Guarded accessor for the Stripe publishable key. Fails loudly when the env is
// missing/placeholder/malformed instead of letting Stripe half-initialize.
const PLACEHOLDER = 'pk_test_your_stripe_sandbox_publishable_key';

export function stripePublishableKey(): string {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  if (!key || key === PLACEHOLDER) {
    throw new Error(
      'VITE_STRIPE_PUBLISHABLE_KEY is missing or a placeholder. Set a real key: ' +
        'pk_test_… on dev, pk_live_… on prod.',
    );
  }
  if (!key.startsWith('pk_')) {
    throw new Error(`VITE_STRIPE_PUBLISHABLE_KEY must be a pk_ publishable key, got "${key.slice(0, 3)}…".`);
  }
  return key;
}
