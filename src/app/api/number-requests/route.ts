// GET  /api/number-requests → the current pending phone-number request (safe fields).
// POST /api/number-requests → ensure a pending request exists (idempotent).
//
// ADOPTED to the modular pattern: thin adapter. Auth via requireBusinessUser (same
// codes as the previous inline resolveAuth + getUser + resolveBusinessContext); the
// business/subscription guards + idempotent insert live in src/server/modules/
// number-requests. Responses (incl. already_assigned, created flags, and the
// number_request_route_failed catch-all) are identical.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError, AppError } from '@/server/core/errors';
import { getNumberRequest, ensureNumberRequest } from '@/server/modules/number-requests/number-requests.service';

export const runtime = 'nodejs';

// Business-logic errors map to their AppError code; any unexpected throw maps to the
// route's historical catch-all, matching the previous inline try/catch.
function mapBusinessError(err: unknown): NextResponse {
  if (err instanceof AppError) return fail(err.code, err.status);
  return fail('number_request_route_failed', 500);
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    return ok(await getNumberRequest(ctx));
  } catch (err) {
    return mapBusinessError(err);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    return ok(await ensureNumberRequest(ctx));
  } catch (err) {
    return mapBusinessError(err);
  }
}
