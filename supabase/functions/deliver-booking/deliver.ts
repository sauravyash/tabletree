import type { StripeGateway } from '../_shared/stripe.ts';

export function computeCharge(
  coffee: number | null,
  items: { price_cents_snapshot: number; quantity: number }[],
): number {
  return (coffee ?? 0) + items.reduce((s, i) => s + i.price_cents_snapshot * i.quantity, 0);
}

export async function runDeliver(
  input: {
    coffee: number | null;
    items: { price_cents_snapshot: number; quantity: number }[];
    customer: string;
    paymentMethod: string;
  },
  gateway: StripeGateway,
): Promise<{ status: 'delivered' | 'payment_failed'; paymentIntentId?: string; error?: string }> {
  const amount = computeCharge(input.coffee, input.items);
  if (amount <= 0) return { status: 'delivered' };
  try {
    const res = await gateway.charge({ amount, customer: input.customer, paymentMethod: input.paymentMethod });
    return { status: 'delivered', paymentIntentId: res.id };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { status: 'payment_failed', error: code ?? 'charge_failed' };
  }
}
