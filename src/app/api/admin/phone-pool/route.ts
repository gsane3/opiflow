import { NextRequest } from 'next/server';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import {
  requirePhonePoolAdmin,
} from '@/server/modules/phone-pool/phone-pool.repo';
import {
  addPoolNumber,
  assignPendingRequest,
  getPool,
  isAssignAction,
  parsePatchBody,
  releaseNumber,
} from '@/server/modules/phone-pool/phone-pool.service';

// ---------------------------------------------------------------------------
// GET /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Returns pool stats and the most recent 200 managed_phone_numbers rows.
// Fields returned per number: id, e164_number, provider, city, number_type,
//   status, imported_at, assigned_at, cooling_down_since, available_after,
//   retired_at, assigned_business_id, assigned_business_name, assignment_status.
// provider_ref, notes, and all sensitive business fields are intentionally excluded.

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePhonePoolAdmin(request.headers.get('authorization'));
    const result = await getPool(ctx);
    return ok({
      stats: result.stats,
      numbers: result.numbers,
      pendingNumberRequests: result.pendingNumberRequests,
      ...(result.pendingRequestsError !== null ? { pendingRequestsError: result.pendingRequestsError } : {}),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Inserts one new managed_phone_numbers row with status = "available".
// Accepts: { e164_number: string, provider?: string, city?: string, notes?: string }
// Returns safe row metadata. provider_ref and notes are not returned.

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePhonePoolAdmin(request.headers.get('authorization'));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_input', 400);
    }

    const number = await addPoolNumber(ctx, body);
    return ok({ number }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/phone-pool
// ---------------------------------------------------------------------------
// Releases a business phone number by calling the release_business_phone_number
// RPC. platform_owned numbers enter 18-month cooldown. customer_ported numbers
// are released without platform cooldown.
// Accepts: { business_id: string, release_reason?: string }
// Does NOT return the e164_number from the RPC result. Returns released boolean,
// managed_phone_number_id, and available_after (null for customer_ported).
//
// Also handles { action: 'assign_pending_request', business_id, requested_city? }
// which assigns an available pool number to a business with a pending request.

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requirePhonePoolAdmin(request.headers.get('authorization'));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_input', 400);
    }

    const raw = parsePatchBody(body);

    // Action: assign_pending_request
    if (isAssignAction(raw)) {
      const result = await assignPendingRequest(ctx, raw);
      if (!result.assigned) {
        return ok({
          assigned: false,
          reason:   result.reason,
        });
      }
      return ok({
        assigned:             true,
        managedPhoneNumberId: result.managedPhoneNumberId,
        e164Number:           result.e164Number,
        ...(result.requestStatus !== null ? { requestStatus: result.requestStatus } : {}),
      });
    }

    // (Existing) Release number action
    const result = await releaseNumber(ctx, raw);
    return ok({
      released:                result.released,
      managed_phone_number_id: result.managed_phone_number_id,
      available_after:         result.available_after,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
