// Stripe gateway seam. This module has NO SDK import so tests stay network-free;
// the real SDK-backed implementation lives in stripe_real.ts.
export interface ChargeResult { id: string }
export interface CustomerResult { id: string }
export interface SetupIntentResult { id: string; clientSecret: string }
export interface RetrievedSetupIntent { id: string; status: string; customer: string; paymentMethod: string }
export interface StripeGateway {
  charge(args: { amount: number; customer: string; paymentMethod: string }): Promise<ChargeResult>;
  createCustomer(args: { email: string | null }): Promise<CustomerResult>;
  createSetupIntent(args: { customer: string }): Promise<SetupIntentResult>;
  retrieveSetupIntent(id: string): Promise<RetrievedSetupIntent>;
}
