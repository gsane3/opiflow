// Phone pool — service (explicit validation + orchestration). Parity-matched to
// /api/admin/phone-pool (GET list, POST add, PATCH assign_pending_request / release).
//
// Every validation throw reproduces the route's EXACT code + status and order
// (invalid_e164, invalid_provider, invalid_notes, invalid_city, invalid_input,
// missing_business_id, invalid_business_id, invalid_release_reason, ...) rather
// than a generic Zod error, so the response contract is unchanged.
//
// Each verb's body preserves the route's single broad catch: any UNEXPECTED throw
// becomes AppError('phone_pool_route_failed', 500); the explicit data-access codes
// (pool_query_failed, pool_insert_failed, duplicate_number, release_rpc_failed,
// assign_rpc_failed, business_not_found, pending_request_not_found) are thrown as
// AppError and rethrown as-is. The pending-requests block is non-fatal: a failure
// sets pendingRequestsError and returns an empty list, exactly like the route.
//
// The assignment helper (assignPhoneNumber) is an EXTERNAL effect (it calls the
// SQL RPC). It is kept thin — the service calls the existing lib verbatim and the
// tests cover only the pure validation/guard throws BEFORE that call.

import { AppError } from '../../core/errors';
import { assignPhoneNumber } from '../../../lib/server/phone-number-pool';
import {
  getBusinessForAssign,
  getPendingRequestForBusiness,
  getRequestStatus,
  insertPoolRow,
  listActiveAssignments,
  listBusinessNameCities,
  listBusinessNames,
  listPendingRequests,
  listPoolRows,
  releaseBusinessPhoneNumber,
  type PoolRow,
  type RepoContext,
} from './phone-pool.repo';

// E.164 validation: starts with +, followed by 8 to 15 digits.
const E164_RE = /^\+\d{8,15}$/;

// UUID validation: standard 8-4-4-4-12 hyphenated hex format.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_PROVIDERS = ['intertelecom'] as const;

// Safe assignment metadata merged into each pool row in GET.
type AssignmentMeta = {
  assigned_business_id:   string | null;
  assigned_business_name: string | null;
  assignment_status:      string | null;
};

type PoolRowEnriched = PoolRow & AssignmentMeta;

type StatsMap = {
  available: number;
  assigned: number;
  reserved: number;
  suspended: number;
  cooling_down: number;
  retired: number;
  total: number;
  by_city: Record<string, number>;
  by_type: Record<string, number>;
  pendingNumberRequests: number;
};

type PendingNumberRequest = {
  request_id:     string;
  business_id:    string;
  business_name:  string | null;
  business_city:  string | null;
  requested_city: string | null;
  source:         string;
  status:         string;
  created_at:     string;
};

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export interface GetPoolResult {
  stats: StatsMap;
  numbers: PoolRowEnriched[];
  pendingNumberRequests: PendingNumberRequest[];
  pendingRequestsError: string | null;
}

export async function getPool(ctx: RepoContext): Promise<GetPoolResult> {
  try {
    const poolRes = await listPoolRows(ctx);
    if (!poolRes.ok) throw new AppError('pool_query_failed', 500);

    const rows = poolRes.rows;

    const stats: StatsMap = {
      available: 0,
      assigned: 0,
      reserved: 0,
      suspended: 0,
      cooling_down: 0,
      retired: 0,
      total: rows.length,
      by_city: {},
      by_type: {},
      pendingNumberRequests: 0,
    };

    for (const row of rows) {
      if (row.status === 'available') stats.available += 1;
      else if (row.status === 'assigned') stats.assigned += 1;
      else if (row.status === 'reserved') stats.reserved += 1;
      else if (row.status === 'suspended') stats.suspended += 1;
      else if (row.status === 'cooling_down') stats.cooling_down += 1;
      else if (row.status === 'retired') stats.retired += 1;

      // Count all numbers per city for inventory planning.
      // Empty string key represents numbers with no city set.
      const cityKey = row.city ?? '';
      stats.by_city[cityKey] = (stats.by_city[cityKey] ?? 0) + 1;

      // Count by number_type for lifecycle distribution visibility.
      const typeKey = row.number_type ?? 'unknown';
      stats.by_type[typeKey] = (stats.by_type[typeKey] ?? 0) + 1;
    }

    // -----------------------------------------------------------------------
    // Business assignment metadata enrichment
    // -----------------------------------------------------------------------
    const enrichedRows: PoolRowEnriched[] = rows.map((r) => ({
      ...r,
      assigned_business_id:   null,
      assigned_business_name: null,
      assignment_status:      null,
    }));

    if (rows.length > 0) {
      const mpnIds = rows.map((r) => r.id);

      // Step 1: fetch active business_phone_numbers rows for this batch.
      const assignRes = await listActiveAssignments(ctx, mpnIds);
      if (!assignRes.ok) throw new AppError('pool_query_failed', 500);

      const assignmentRows = assignRes.rows;

      if (assignmentRows.length > 0) {
        // Build mpnId -> { business_id, status } lookup.
        const assignMap = new Map<string, { business_id: string; status: string }>();
        for (const a of assignmentRows) {
          assignMap.set(a.managed_phone_number_id, {
            business_id: a.business_id,
            status:      a.status,
          });
        }

        // Step 2: fetch id + name for the assigned businesses only.
        const businessIds = [...new Set(assignmentRows.map((a) => a.business_id))];

        const bizRes = await listBusinessNames(ctx, businessIds);
        if (!bizRes.ok) throw new AppError('pool_query_failed', 500);

        const bizRows = bizRes.rows;
        const bizMap = new Map<string, string>();
        for (const b of bizRows) {
          bizMap.set(b.id, b.name);
        }

        // Merge into enriched rows.
        for (const row of enrichedRows) {
          const assignment = assignMap.get(row.id);
          if (assignment) {
            row.assigned_business_id   = assignment.business_id;
            row.assigned_business_name = bizMap.get(assignment.business_id) ?? null;
            row.assignment_status      = assignment.status;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pending phone number requests (non-fatal)
    // -----------------------------------------------------------------------
    let pendingNumberRequests: PendingNumberRequest[] = [];
    let pendingRequestsError: string | null = null;

    try {
      const pendingRes = await listPendingRequests(ctx);

      if (!pendingRes.ok) {
        pendingRequestsError = 'pending_requests_query_failed';
      } else {
        const prRows = pendingRes.rows;

        if (prRows.length > 0) {
          const prBizIds = [...new Set(prRows.map((r) => r.business_id))];

          const prBizRes = await listBusinessNameCities(ctx, prBizIds);

          const prBizMap = new Map<string, { name: string | null; city: string | null }>();
          if (prBizRes.ok) {
            for (const b of prBizRes.rows) {
              prBizMap.set(b.id, { name: b.name ?? null, city: b.city ?? null });
            }
          }

          pendingNumberRequests = prRows.map((r) => {
            const biz = prBizMap.get(r.business_id);
            return {
              request_id:     r.id,
              business_id:    r.business_id,
              business_name:  biz?.name ?? null,
              business_city:  biz?.city ?? null,
              requested_city: r.requested_city,
              source:         r.source,
              status:         r.status,
              created_at:     r.created_at,
            };
          });
        }
      }
    } catch {
      pendingRequestsError = 'pending_requests_query_failed';
    }

    stats.pendingNumberRequests = pendingNumberRequests.length;

    return {
      stats,
      numbers: enrichedRows,
      pendingNumberRequests,
      pendingRequestsError,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('phone_pool_route_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function addPoolNumber(ctx: RepoContext, body: unknown): Promise<PoolRow> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('invalid_input', 400);
  }

  const raw = body as Record<string, unknown>;

  // Validate e164_number
  const rawE164 = raw['e164_number'];
  if (typeof rawE164 !== 'string') {
    throw new AppError('invalid_e164', 400);
  }
  const e164 = rawE164.trim();
  if (!E164_RE.test(e164)) {
    throw new AppError('invalid_e164', 400);
  }

  // Validate provider (defaults to intertelecom)
  const rawProvider = raw['provider'];
  const provider: string =
    rawProvider === undefined || rawProvider === null
      ? 'intertelecom'
      : String(rawProvider).trim();

  if (!(ALLOWED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new AppError('invalid_provider', 400);
  }

  // Validate notes (optional, max 500 chars)
  let notes: string | null = null;
  const rawNotes = raw['notes'];
  if (rawNotes !== undefined && rawNotes !== null) {
    if (typeof rawNotes !== 'string') {
      throw new AppError('invalid_notes', 400);
    }
    const trimmedNotes = rawNotes.trim();
    if (trimmedNotes.length > 500) {
      throw new AppError('invalid_notes', 400);
    }
    notes = trimmedNotes.length > 0 ? trimmedNotes : null;
  }

  // Validate city (optional, max 100 chars)
  let city: string | null = null;
  const rawCity = raw['city'];
  if (rawCity !== undefined && rawCity !== null) {
    if (typeof rawCity !== 'string') {
      throw new AppError('invalid_city', 400);
    }
    const trimmedCity = rawCity.trim();
    if (trimmedCity.length > 100) {
      throw new AppError('invalid_city', 400);
    }
    city = trimmedCity.length > 0 ? trimmedCity : null;
  }

  try {
    const insertPayload: Record<string, unknown> = {
      e164_number: e164,
      provider,
      status: 'available',
    };
    if (city !== null) {
      insertPayload['city'] = city;
    }
    if (notes !== null) {
      insertPayload['notes'] = notes;
    }

    const insertRes = await insertPoolRow(ctx, insertPayload);
    if (!insertRes.ok) {
      if (insertRes.code === 'duplicate_number') {
        throw new AppError('duplicate_number', 409);
      }
      throw new AppError('pool_insert_failed', 500);
    }

    return insertRes.row;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('phone_pool_route_failed', 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH — discriminated by action
// ---------------------------------------------------------------------------

export type AssignResult =
  | { assigned: false; reason: 'no_available_number' }
  | {
      assigned: true;
      managedPhoneNumberId: string | null;
      e164Number: string | null;
      requestStatus: string | null;
    };

export interface ReleaseResultDto {
  released: boolean;
  managed_phone_number_id: string | null;
  available_after: string | null;
}

/**
 * PATCH dispatch. Mirrors the route: the assign_pending_request action branch is
 * selected by `action === 'assign_pending_request'`; everything else falls
 * through to the release path. The body must already be a validated object
 * (invalid_input thrown by the route before the parse boundary mirror below).
 */
export function parsePatchBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('invalid_input', 400);
  }
  return body as Record<string, unknown>;
}

export function isAssignAction(raw: Record<string, unknown>): boolean {
  return raw['action'] === 'assign_pending_request';
}

export async function assignPendingRequest(
  ctx: RepoContext,
  raw: Record<string, unknown>,
): Promise<AssignResult> {
  // Validate business_id: required, non-empty UUID.
  const rawAssignBizId = raw['business_id'];
  if (typeof rawAssignBizId !== 'string' || !rawAssignBizId.trim()) {
    throw new AppError('missing_business_id', 400);
  }
  const assignBizId = rawAssignBizId.trim();
  if (!UUID_RE.test(assignBizId)) {
    throw new AppError('invalid_business_id', 400);
  }

  // Validate optional requested_city from payload (lowest priority city source).
  let payloadCity: string | null = null;
  const rawPayloadCity = raw['requested_city'];
  if (rawPayloadCity !== undefined && rawPayloadCity !== null) {
    if (typeof rawPayloadCity !== 'string') {
      throw new AppError('invalid_city', 400);
    }
    const trimmedPayloadCity = rawPayloadCity.trim();
    if (trimmedPayloadCity.length > 100) {
      throw new AppError('invalid_city', 400);
    }
    payloadCity = trimmedPayloadCity.length > 0 ? trimmedPayloadCity : null;
  }

  try {
    // Confirm business exists and fetch its city for fallback.
    const bizRes = await getBusinessForAssign(ctx, assignBizId);
    if (!bizRes.ok) {
      throw new AppError('assign_rpc_failed', 500);
    }
    if (!bizRes.row) {
      throw new AppError('business_not_found', 404);
    }
    const bizForAssign = bizRes.row;

    // Confirm a pending phone_number_requests row exists for this business.
    const pendingReqRes = await getPendingRequestForBusiness(ctx, assignBizId);
    if (!pendingReqRes.ok) {
      throw new AppError('assign_rpc_failed', 500);
    }
    if (!pendingReqRes.row) {
      throw new AppError('pending_request_not_found', 404);
    }
    const pendingReq = pendingReqRes.row;

    // City priority: pending request city > business city > payload city.
    const effectiveCity = pendingReq.requested_city ?? bizForAssign.city ?? payloadCity;

    // Call the assignment helper. Migration 019 resolves the pending request
    // atomically inside assign_available_phone_number when assigned is true.
    const assignRpcResult = await assignPhoneNumber(ctx.supabase, assignBizId, effectiveCity);

    if (!assignRpcResult.assigned) {
      return {
        assigned: false,
        reason:   'no_available_number',
      };
    }

    // Query updated request status to confirm resolution. Non-fatal.
    let requestStatus: string | null = null;
    try {
      requestStatus = await getRequestStatus(ctx, pendingReq.id);
    } catch {
      // Non-fatal. Omit requestStatus from response.
    }

    return {
      assigned:             true,
      managedPhoneNumberId: assignRpcResult.managedPhoneNumberId,
      e164Number:           assignRpcResult.e164Number,
      requestStatus,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('phone_pool_route_failed', 500);
  }
}

export async function releaseNumber(
  ctx: RepoContext,
  raw: Record<string, unknown>,
): Promise<ReleaseResultDto> {
  // Validate business_id: required, must be a UUID.
  const rawBusinessId = raw['business_id'];
  if (typeof rawBusinessId !== 'string') {
    throw new AppError('missing_business_id', 400);
  }
  const businessId = rawBusinessId.trim();
  if (!UUID_RE.test(businessId)) {
    throw new AppError('invalid_business_id', 400);
  }

  // Validate release_reason: optional, trimmed, capped at 100 chars, defaults to "cancelled".
  let releaseReason = 'cancelled';
  const rawReason = raw['release_reason'];
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== 'string') {
      throw new AppError('invalid_release_reason', 400);
    }
    const trimmed = rawReason.trim();
    if (trimmed.length > 100) {
      throw new AppError('invalid_release_reason', 400);
    }
    releaseReason = trimmed.length > 0 ? trimmed : 'cancelled';
  }

  try {
    const releaseRes = await releaseBusinessPhoneNumber(ctx, businessId, releaseReason);

    if (!releaseRes.ok) {
      throw new AppError('release_rpc_failed', 500);
    }

    // RETURNS TABLE from Postgres comes back as an array of rows via Supabase JS.
    const rows = releaseRes.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError('release_rpc_failed', 500);
    }

    const row = rows[0];

    // e164_number is intentionally not forwarded to the caller.
    return {
      released:                row.released === true,
      managed_phone_number_id: row.managed_phone_number_id ?? null,
      available_after:         row.available_after ?? null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('phone_pool_route_failed', 500);
  }
}
