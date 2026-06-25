// Admin — service (explicit validation + orchestration). Parity-matched to
// GET /api/admin/me.
//
// The validation order and EVERY error code/status are a faithful port of the
// live route, just throw-based so the thin handler can funnel through
// handleApiError:
//
//   missing_auth (401)          — no/!Bearer authorization header
//   admin_not_configured (503)  — ADMIN_USER_ID env unset
//   missing_supabase_config /   — client construction failure (per createAdminSupabaseClient)
//   admin_check_failed
//   invalid_auth (401)          — getUser error or no user
//   admin_required (403)        — authenticated, but not the configured admin
//
// ADMIN_USER_ID is read here and NEVER returned. Deps (env getter + client
// factory) are injectable so the validation throws can be tested hermetically.

import type { NextRequest } from 'next/server';
import { AppError } from '../../core/errors';
import {
  createAdminSupabaseClient,
  getUserFromToken,
  type AdminAuthUser,
  type AdminSupabaseClient,
} from './admin.repo';

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export interface AdminIdentityDeps {
  /** Read the configured admin user id (defaults to ADMIN_USER_ID env). */
  getAdminUserId?: () => string | undefined;
  /** Build the auth client (defaults to the service-role client factory). */
  createClient?: () => AdminSupabaseClient;
}

export async function getAdminIdentity(
  request: NextRequest,
  deps: AdminIdentityDeps = {},
): Promise<AdminAuthUser> {
  const token = getBearerToken(request);
  if (!token) throw new AppError('missing_auth', 401);

  const getAdminUserId = deps.getAdminUserId ?? (() => process.env.ADMIN_USER_ID);
  const adminUserId = getAdminUserId();
  if (!adminUserId) throw new AppError('admin_not_configured', 503);

  const createClient = deps.createClient ?? createAdminSupabaseClient;
  const supabase = createClient();

  const user = await getUserFromToken(supabase, token);

  if (user.id !== adminUserId) throw new AppError('admin_required', 403);

  return user;
}
