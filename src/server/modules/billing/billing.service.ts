// Billing — service (Stripe Checkout + Customer-Portal orchestration).
// Parity-matched to POST /api/billing/checkout and POST /api/billing/portal.
//
// These routes have NO tenant-DB writes: the post-auth logic is pure Stripe-SDK
// orchestration (plus, for the portal, an auth-admin email lookup → repo). The
// owner gate, the Stripe config gate, and the auth all stay verbatim in the thin
// route; this service only builds the Stripe request and maps the helper result.
//
// The Stripe helpers (createCheckoutSession / createPortalSession /
// findCustomerIdByEmail) stay THIN — imported verbatim from lib/billing/stripe.
// Result handling is preserved EXACTLY: a successful session requires a string
// `url`, otherwise the route returns *_failed (502); the portal's missing-email
// (400 no_email) and missing-customer (404 no_customer) branches are preserved in
// order. Each flow returns a discriminated result the route maps to the SAME
// `{ ok, url }` / `{ ok:false, error }` body + status, byte-for-byte.

import {
  createCheckoutSession,
  createPortalSession,
  findCustomerIdByEmail,
} from '../../../lib/billing/stripe';
import { getStripeCustomerId, getUserEmail, type SupabaseServer } from './billing.repo';

export type CheckoutResult =
  | { kind: 'ok'; url: string }
  | { kind: 'checkout_failed' };

/**
 * Create a Stripe Checkout subscription session for the caller's business.
 * Mirrors the route exactly: builds the session via the thin Stripe helper, then
 * `!result.ok || typeof result.data.url !== 'string'` → checkout_failed (502).
 */
export async function startCheckout(opts: {
  priceId: string;
  businessId: string;
  origin: string;
}): Promise<CheckoutResult> {
  const result = await createCheckoutSession({
    priceId: opts.priceId,
    businessId: opts.businessId,
    successUrl: `${opts.origin}/settings?billing=success`,
    cancelUrl: `${opts.origin}/settings?billing=cancelled`,
  });
  if (!result.ok || typeof result.data.url !== 'string') {
    return { kind: 'checkout_failed' };
  }
  return { kind: 'ok', url: result.data.url };
}

export type PortalResult =
  | { kind: 'ok'; url: string }
  | { kind: 'no_email' }
  | { kind: 'no_customer' }
  | { kind: 'portal_failed' };

/**
 * Open the Stripe customer billing portal for the caller. Resolution order:
 *   1. The stripe_customer_id stored on the business's subscription (RELIABLE —
 *      persisted by the webhook; immune to email drift).
 *   2. Fallback for legacy subscriptions whose id wasn't persisted: the user's
 *      email → Stripe customer lookup (→ no_email 400 / no_customer 404).
 * Then create the portal session (→ portal_failed 502 unless a string `url`).
 */
export async function startPortal(opts: {
  supabase: SupabaseServer;
  userId: string;
  businessId: string;
  origin: string;
}): Promise<PortalResult> {
  let customerId = await getStripeCustomerId(opts.supabase, opts.businessId);

  if (!customerId) {
    const email = await getUserEmail(opts.supabase, opts.userId);
    if (!email) return { kind: 'no_email' };
    customerId = await findCustomerIdByEmail(email);
    if (!customerId) return { kind: 'no_customer' };
  }

  const result = await createPortalSession({
    customerId,
    returnUrl: `${opts.origin}/settings`,
  });
  if (!result.ok || typeof result.data.url !== 'string') {
    return { kind: 'portal_failed' };
  }
  return { kind: 'ok', url: result.data.url };
}
