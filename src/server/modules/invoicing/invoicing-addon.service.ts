// Invoicing add-on — the SEPARATE monthly Stripe subscription that bills the
// optional AADE/myDATA feature (price STRIPE_INVOICING_PRICE_ID), distinct from the
// main plan. Two halves:
//   - startAddonCheckout: build a Stripe Checkout session stamped with
//     metadata.kind='invoicing_addon' (so the webhook can route it).
//   - applyAddonSubscriptionEvent: the webhook handler that writes the add-on
//     entitlement onto business_invoicing_settings (NEVER touches the main plan's
//     business_subscriptions table — no collision, both keyed by business_id).
// Fully env-gated: dormant until STRIPE_INVOICING_PRICE_ID + Stripe are configured.

import { createCheckoutSession, isStripeConfigured } from '../../../lib/billing/stripe';
import { applyAddonSubscription, type RepoContext } from './invoicing.repo';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export const ADDON_KIND = 'invoicing_addon';

/** True only when the add-on can actually bill end-to-end (Stripe + a price id). */
export function isInvoicingAddonConfigured(): boolean {
  return isStripeConfigured() && !!process.env.STRIPE_INVOICING_PRICE_ID;
}

export type AddonCheckoutResult = { kind: 'ok'; url: string } | { kind: 'checkout_failed' };

/** Create a Stripe Checkout subscription session for the invoicing add-on. */
export async function startAddonCheckout(opts: {
  businessId: string;
  origin: string;
}): Promise<AddonCheckoutResult> {
  const priceId = process.env.STRIPE_INVOICING_PRICE_ID;
  if (!priceId) return { kind: 'checkout_failed' };
  const result = await createCheckoutSession({
    priceId,
    businessId: opts.businessId,
    kind: ADDON_KIND,
    successUrl: `${opts.origin}/settings?invoicing=success`,
    cancelUrl: `${opts.origin}/settings?invoicing=cancelled`,
  });
  if (!result.ok || typeof result.data.url !== 'string') return { kind: 'checkout_failed' };
  return { kind: 'ok', url: result.data.url };
}

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;
type StripeEvent = { id?: string; type?: string; data?: { object?: Record<string, unknown> } };

/**
 * Apply a Stripe event carrying metadata.kind='invoicing_addon' to the tenant's
 * invoicing settings. Returns the SAME boolean contract the webhook route uses:
 *   true  → acknowledged (success, OR a permanent pre-068 column-missing we won't retry)
 *   false → transient DB failure → the route returns 500 so Stripe retries.
 */
export async function applyAddonSubscriptionEvent(
  supabase: SupabaseServer,
  event: StripeEvent,
  businessId: string
): Promise<boolean> {
  const obj = event.data?.object ?? {};
  const subscriptionId =
    typeof obj.subscription === 'string' ? obj.subscription : typeof obj.id === 'string' ? obj.id : null;

  const fields: Record<string, unknown> = {};
  if (event.type === 'checkout.session.completed') {
    fields.addon_status = 'active';
    if (subscriptionId) fields.addon_subscription_id = subscriptionId;
  } else if (event.type === 'customer.subscription.updated') {
    const s = typeof obj.status === 'string' ? obj.status : '';
    if (s === 'active' || s === 'trialing') {
      fields.addon_status = 'active';
      if (subscriptionId) fields.addon_subscription_id = subscriptionId;
    } else if (s === 'canceled' || s === 'unpaid' || s === 'incomplete_expired') {
      fields.addon_status = 'cancelled';
    }
    // transient states (past_due, incomplete) → no change
  } else if (event.type === 'customer.subscription.deleted') {
    fields.addon_status = 'cancelled';
  }

  // Period end (present on subscription objects, not the checkout session).
  if (typeof obj.current_period_end === 'number') {
    fields.addon_current_period_end = new Date(obj.current_period_end * 1000).toISOString();
  }

  // Nothing actionable in this event (e.g. an updated→past_due) — acknowledge.
  if (Object.keys(fields).length === 0) return true;

  const ctx = { supabase, businessId, userId: 'stripe-webhook', role: 'owner' } as unknown as RepoContext;
  const res = await applyAddonSubscription(ctx, fields);
  if (res.ok) return true;
  // Pre-068 (column/table missing) is permanent — ack so Stripe stops retrying.
  return res.columnMissing;
}
