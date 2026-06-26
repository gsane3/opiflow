// Phone pool — repository (global-admin gate + data access).
//
// /api/admin/phone-pool is NOT business-scoped: it is the platform-wide phone
// inventory console, gated against the configured ADMIN_USER_ID. So it does NOT
// use authenticateBusinessRequest / tenantDb (no business is ever resolved).
// Every query touches pool / cross-tenant tables (managed_phone_numbers,
// business_phone_numbers, businesses, phone_number_requests), so the
// business_id auto-filter would be wrong — the repo talks to the service-role
// client directly with explicit filters.
//
// This file isolates the two auth side effects (building the service-role client
// and resolving the bearer token to a Supabase user) behind injectable seams, so
// the service can be unit-tested with zero env and no real DB, and preserves the
// route's EXACT failure codes:
//
//   missing_auth (401)             — no/!Bearer authorization header
//   admin_not_configured (503)     — ADMIN_USER_ID env unset
//   missing_supabase_config (503)  — Supabase server env missing
//   phone_pool_route_failed (500)  — any other client-construction failure
//   invalid_auth (401)             — getUser error or no user
//   forbidden (403)                — authenticated, but not the configured admin
//
// ADMIN_USER_ID is read here and NEVER returned.

import { AppError } from '../../core/errors';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

type ServiceClient = ReturnType<typeof createServerSupabaseClient>;

/** Resolved context for every phone-pool repo call: just the authed client. */
export interface RepoContext {
  supabase: ServiceClient;
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export interface PhonePoolAdminDeps {
  /** Read the configured admin user id (defaults to ADMIN_USER_ID env). */
  getAdminUserId?: () => string | undefined;
  /** Build the service-role client (defaults to the real factory). */
  createClient?: () => ServiceClient;
}

/**
 * Build the service-role client, mapping the two failure shapes the route
 * distinguishes: a missing-config message → missing_supabase_config (503),
 * any other throw → phone_pool_route_failed (500).
 */
export function createPhonePoolSupabaseClient(): ServiceClient {
  try {
    return createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      throw new AppError('missing_supabase_config', 503);
    }
    throw new AppError('phone_pool_route_failed', 500);
  }
}

/**
 * Validate the caller is the configured global admin and return the authed
 * client. Mirrors the route's checkAdmin order and codes exactly:
 *   missing_auth → admin_not_configured → client build → invalid_auth → forbidden.
 */
export async function requirePhonePoolAdmin(
  authHeader: string | null,
  deps: PhonePoolAdminDeps = {},
): Promise<RepoContext> {
  const token = getBearerToken(authHeader);
  if (!token) throw new AppError('missing_auth', 401);

  const getAdminUserId = deps.getAdminUserId ?? (() => process.env.ADMIN_USER_ID);
  const adminUserId = getAdminUserId();
  if (!adminUserId) throw new AppError('admin_not_configured', 503);

  const createClient = deps.createClient ?? createPhonePoolSupabaseClient;
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) throw new AppError('invalid_auth', 401);

  if (user.id !== adminUserId) throw new AppError('forbidden', 403);

  return { supabase };
}

// ---------------------------------------------------------------------------
// GET data access — pool rows, assignment enrichment, pending requests
// ---------------------------------------------------------------------------

export type PoolRow = {
  id: string;
  e164_number: string;
  provider: string;
  city: string | null;
  number_type: string | null;
  status: string;
  imported_at: string;
  assigned_at: string | null;
  cooling_down_since: string | null;
  available_after: string | null;
  retired_at: string | null;
};

export type AssignmentRow = {
  managed_phone_number_id: string;
  business_id: string;
  status: string;
};

export type BusinessNameRow = { id: string; name: string };
export type BusinessNameCityRow = { id: string; name: string | null; city: string | null };

export type PendingRequestRow = {
  id: string;
  business_id: string;
  requested_city: string | null;
  source: string;
  status: string;
  created_at: string;
};

export type PoolQueryResult =
  | { ok: true; rows: PoolRow[] }
  | { ok: false };

/** Most recent 200 managed_phone_numbers rows (newest first). */
export async function listPoolRows(ctx: RepoContext): Promise<PoolQueryResult> {
  const { data, error } = await ctx.supabase
    .from('managed_phone_numbers')
    .select('id, e164_number, provider, city, number_type, status, imported_at, assigned_at, cooling_down_since, available_after, retired_at')
    .order('imported_at', { ascending: false })
    .limit(200);

  if (error) return { ok: false };
  return { ok: true, rows: (data ?? []) as unknown as PoolRow[] };
}

export type AssignmentsResult =
  | { ok: true; rows: AssignmentRow[] }
  | { ok: false };

/** Active business_phone_numbers rows for a batch of managed numbers. */
export async function listActiveAssignments(
  ctx: RepoContext,
  mpnIds: string[],
): Promise<AssignmentsResult> {
  const { data, error } = await ctx.supabase
    .from('business_phone_numbers')
    .select('managed_phone_number_id, business_id, status')
    .in('managed_phone_number_id', mpnIds)
    .eq('status', 'active');

  if (error) return { ok: false };
  return { ok: true, rows: (data ?? []) as AssignmentRow[] };
}

export type BusinessNamesResult =
  | { ok: true; rows: BusinessNameRow[] }
  | { ok: false };

/** id + name for the assigned businesses only. */
export async function listBusinessNames(
  ctx: RepoContext,
  businessIds: string[],
): Promise<BusinessNamesResult> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('id, name')
    .in('id', businessIds);

  if (error) return { ok: false };
  return { ok: true, rows: (data ?? []) as BusinessNameRow[] };
}

export type PendingRequestsResult =
  | { ok: true; rows: PendingRequestRow[] }
  | { ok: false };

/** Pending phone_number_requests (oldest first, capped at 100). */
export async function listPendingRequests(ctx: RepoContext): Promise<PendingRequestsResult> {
  const { data, error } = await ctx.supabase
    .from('phone_number_requests')
    .select('id, business_id, requested_city, source, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return { ok: false };
  return { ok: true, rows: (data ?? []) as PendingRequestRow[] };
}

/** Safe business metadata (id, name, city) for the pending requests batch. */
export async function listBusinessNameCities(
  ctx: RepoContext,
  businessIds: string[],
): Promise<{ ok: boolean; rows: BusinessNameCityRow[] }> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('id, name, city')
    .in('id', businessIds);

  if (error || !data) return { ok: false, rows: [] };
  return { ok: true, rows: data as BusinessNameCityRow[] };
}

// ---------------------------------------------------------------------------
// POST data access — insert a new pool number
// ---------------------------------------------------------------------------

export type InsertPoolResult =
  | { ok: true; row: PoolRow }
  | { ok: false; code: 'duplicate_number' | 'pool_insert_failed' };

/** Insert one managed_phone_numbers row; maps unique-violation → duplicate_number. */
export async function insertPoolRow(
  ctx: RepoContext,
  insertPayload: Record<string, unknown>,
): Promise<InsertPoolResult> {
  const { data: inserted, error: insertError } = await ctx.supabase
    .from('managed_phone_numbers')
    .insert(insertPayload)
    .select('id, e164_number, provider, city, number_type, status, imported_at, assigned_at, cooling_down_since, available_after, retired_at')
    .single();

  if (insertError) {
    // Postgres unique violation code is 23505.
    if (
      insertError.code === '23505' ||
      insertError.message?.toLowerCase().includes('unique')
    ) {
      return { ok: false, code: 'duplicate_number' };
    }
    return { ok: false, code: 'pool_insert_failed' };
  }

  return { ok: true, row: inserted as unknown as PoolRow };
}

// ---------------------------------------------------------------------------
// PATCH (assign_pending_request) data access
// ---------------------------------------------------------------------------

export type BizForAssignResult =
  | { ok: true; row: { id: string; city: string | null } | null }
  | { ok: false };

/** Confirm a business exists and fetch its city. */
export async function getBusinessForAssign(
  ctx: RepoContext,
  businessId: string,
): Promise<BizForAssignResult> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('id, city')
    .eq('id', businessId)
    .maybeSingle();

  if (error) return { ok: false };
  return { ok: true, row: (data as { id: string; city: string | null } | null) ?? null };
}

export type PendingReqForBizResult =
  | { ok: true; row: { id: string; requested_city: string | null } | null }
  | { ok: false };

/** Confirm a pending request row exists for the business. */
export async function getPendingRequestForBusiness(
  ctx: RepoContext,
  businessId: string,
): Promise<PendingReqForBizResult> {
  const { data, error } = await ctx.supabase
    .from('phone_number_requests')
    .select('id, requested_city')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) return { ok: false };
  return { ok: true, row: (data as { id: string; requested_city: string | null } | null) ?? null };
}

/** Re-read the request status after assignment (non-fatal best-effort). */
export async function getRequestStatus(
  ctx: RepoContext,
  requestId: string,
): Promise<string | null> {
  const { data: updatedReq } = await ctx.supabase
    .from('phone_number_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle();
  if (updatedReq) {
    return (updatedReq as { status: string }).status;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PATCH (release) data access
// ---------------------------------------------------------------------------

export type ReleaseRow = {
  released: boolean;
  managed_phone_number_id: string | null;
  e164_number: string | null;
  available_after: string | null;
};

export type ReleaseResult =
  | { ok: true; rows: ReleaseRow[] }
  | { ok: false };

/** Call the release_business_phone_number RPC. */
export async function releaseBusinessPhoneNumber(
  ctx: RepoContext,
  businessId: string,
  releaseReason: string,
): Promise<ReleaseResult> {
  const { data, error: rpcError } = await ctx.supabase.rpc('release_business_phone_number', {
    p_business_id:    businessId,
    p_release_reason: releaseReason,
  });

  if (rpcError) return { ok: false };
  return { ok: true, rows: data as unknown as ReleaseRow[] };
}
