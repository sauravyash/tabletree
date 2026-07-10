// Stripe gateway seam. This module has NO SDK import so tests stay network-free;
// the real SDK-backed implementation lives in stripe_real.ts.
export interface ChargeResult {
  id: string;
}

export interface StripeGateway {
  charge(args: { amount: number; customer: string; paymentMethod: string }): Promise<ChargeResult>;
}
