import Stripe from 'https://esm.sh/stripe@14?target=deno';
import type { StripeGateway } from './stripe.ts';

// Real, test-mode Stripe implementation of the gateway seam.
export class RealStripe implements StripeGateway {
  private stripe: Stripe;
  constructor(secret: string) {
    this.stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
  }
  async charge({ amount, customer, paymentMethod }: { amount: number; customer: string; paymentMethod: string }) {
    const pi = await this.stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer,
      payment_method: paymentMethod,
      off_session: true,
      confirm: true,
    });
    return { id: pi.id };
  }
}
