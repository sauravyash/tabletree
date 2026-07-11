export type ConfirmResult =
  | { ok: true; customer: string; paymentMethod: string }
  | { ok: false; error: string };

// Validate a retrieved SetupIntent before trusting it to stamp a booking. The
// caller passes the booking's expected customer so a foreign intent is rejected.
export function evaluateSetupIntent(
  si: { status: string; customer: string; paymentMethod: string },
  expectedCustomer: string | null,
): ConfirmResult {
  if (si.status !== 'succeeded') return { ok: false, error: 'setup_not_succeeded' };
  if (expectedCustomer && si.customer !== expectedCustomer) return { ok: false, error: 'customer_mismatch' };
  if (!si.paymentMethod) return { ok: false, error: 'no_payment_method' };
  return { ok: true, customer: si.customer, paymentMethod: si.paymentMethod };
}
