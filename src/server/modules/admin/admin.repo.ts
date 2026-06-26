// Admin — repository (auth-user lookup for the global-admin gate).
//
// admin/me is NOT business-scoped: it checks the caller against the
// configured ADMIN_USER_ID, so it does NOT use authenticateBusinessRequest /
// tenantDb (no business is ever resolved). This repo isolates the two side
// effects the route performs — building the service-role client and resolving
// the bearer token to a Supabase user — behind small, injectable seams so the
// service can be unit-tested with zero env and no real DB.

import { AppError } from '../../core/errors';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export interface AdminAuthUser {
  id: string;
  email: string | null;
}

/** A minimal client surface: just the auth.getUser(token) call this route needs. */
export interface AdminSupabaseClient {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
}

/**
 * Build the service-role client, mapping the two failure shapes the route
 * distinguishes: a missing-config message → missing_supabase_config (503),
 * any other throw → admin_check_failed (500).
 */
export function createAdminSupabaseClient(): AdminSupabaseClient {
  try {
    return createServerSupabaseClient() as unknown as AdminSupabaseClient;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      throw new AppError('missing_supabase_config', 503);
    }
    throw new AppError('admin_check_failed', 500);
  }
}

/**
 * Resolve the bearer token to a Supabase user. A getUser error OR a null user
 * → invalid_auth (401), matching the route's single guard.
 */
export async function getUserFromToken(
  client: AdminSupabaseClient,
  token: string,
): Promise<AdminAuthUser> {
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(token);

  if (authError || !user) {
    throw new AppError('invalid_auth', 401);
  }

  return { id: user.id, email: user.email ?? null };
}
