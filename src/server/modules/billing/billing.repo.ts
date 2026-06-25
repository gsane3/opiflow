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
