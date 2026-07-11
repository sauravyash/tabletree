import type { StripeGateway } from '../_shared/stripe.ts';

// Reuse the booking's existing Stripe customer, or create one. Kept pure/testable;
// the handler persists a newly-created customer id back onto the booking.
export async function resolveCustomer(
  booking: { stripe_customer_id: string | null; email: string | null },
  gateway: Pick<StripeGateway, 'createCustomer'>,
): Promise<{ customerId: string; created: boolean }> {
  if (booking.stripe_customer_id) return { customerId: booking.stripe_customer_id, created: false };
  const c = await gateway.createCustomer({ email: booking.email });
  return { customerId: c.id, created: true };
}
