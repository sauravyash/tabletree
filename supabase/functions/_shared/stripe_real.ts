import Stripe from 'https://esm.sh/stripe@14?target=deno';
import type { StripeGateway } from './stripe.ts';

// Real, test-mode Stripe implementation of the gateway seam.
export class RealStripe implements StripeGateway {
  private stripe: Stripe;
  constructor(secret: string) {
    // Use Stripe's Fetch-based HTTP client. The default Node client relies on
    // Deno.core.runMicrotasks(), which the Supabase Edge (Deno) runtime does not
    // support and which surfaces as an unhandled event-loop error on every call.
    this.stripe = new Stripe(secret, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  async charge({ amount, customer, paymentMethod }: { amount: number; customer: string; paymentMethod: string }) {
    const pi = await this.stripe.paymentIntents.create({
      amount, currency: 'usd', customer, payment_method: paymentMethod, off_session: true, confirm: true,
    });
    return { id: pi.id };
  }
  async createCustomer({ email }: { email: string | null }) {
    const c = await this.stripe.customers.create(email ? { email } : {});
    return { id: c.id };
  }
  async createSetupIntent({ customer }: { customer: string }) {
    const si = await this.stripe.setupIntents.create({
      customer, usage: 'off_session', payment_method_types: ['card'],
    });
    return { id: si.id, clientSecret: si.client_secret! };
  }
  async retrieveSetupIntent(id: string) {
    const si = await this.stripe.setupIntents.retrieve(id);
    return {
      id: si.id,
      status: si.status,
      customer: (si.customer as string) ?? '',
      paymentMethod: (si.payment_method as string) ?? '',
    };
  }
}
