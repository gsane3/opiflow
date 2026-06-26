// Billing — repository (data access for the customer-portal email lookup).
//
// Parity-matched to POST /api/billing/portal. The portal route needs the caller's
// email to find their Stripe customer; it reads it from the auth user via the
// service client's admin API, swallowing any failure (→ null). This mirrors the
// route's exact try/catch-ignore behaviour. No tenant DB table is touched here —
// this is an auth-admin lookup keyed by the authenticated userId, not a query that
// could cross tenants — so it does NOT go through tenantDb.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

/**
 * Best-effort lookup of the auth user's email by id. Returns null on any error
 * (the catch swallows it), exactly like the live route's
 * `try { … } catch { /* ignore *​/ }` around `auth.admin.getUserById`.
 */
export async function getUserEmail(
  supabase: SupabaseServer,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    // ignore
    return null;
  }
}

/**
 * The Stripe customer id stored on the business's subscription (persisted by the
 * webhook). This is the RELIABLE key for the billing portal — unlike the user's
 * email, it can't drift from what Stripe has. Tolerant: returns null on any error
 * (pre-061 schema, no row, DB hiccup) so the caller falls back to the email lookup.
 */
export async function getStripeCustomerId(
  supabase: SupabaseServer,
  businessId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('business_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', businessId)
      .maybeSingle();
    const id = (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
