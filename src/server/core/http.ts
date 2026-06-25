// HTTP adapter helpers.
//
// PR-1 foundation: ADDITIVE, imported by no live route yet → zero runtime change.
//
// Bridges the existing `authenticateBusinessRequest()` (which RETURNS a ready
// NextResponse on failure) to a throw-based style, so a handler can use a single
// try/catch + `handleApiError`. Adopting this changes NO behaviour: same bearer
// token, same Supabase getUser, same membership/owner resolution, same status codes.

import type { NextRequest } from 'next/server';
import {
  authenticateBusinessRequest,
  isManagerRole,
  type BusinessAuthContext,
} from '../../lib/api/auth';
import { AppError } from './errors';

/** The resolved caller: { supabase, userId, businessId, role }. */
export type RequestContext = BusinessAuthContext;

/**
 * Authenticate the request and resolve its business, or throw an AppError that
 * `handleApiError` turns back into the exact same response the legacy path returned.
 */
export async function requireBusinessUser(request: NextRequest): Promise<RequestContext> {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) {
    const status = auth.error.status;
    const code = await readErrorCode(auth.error);
    throw new AppError(code, status);
  }
  return auth.ctx;
}

/** Reads the `{ ok:false, error }` code out of the legacy NextResponse (best-effort). */
async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? 'unauthorized';
  } catch {
    return 'unauthorized';
  }
}

/** Owner-only guard (throws → 403 forbidden_owner_only). */
export function assertOwner(ctx: RequestContext): void {
  if (ctx.role !== 'owner') throw new AppError('forbidden_owner_only', 403);
}

/** Owner/admin guard (throws → 403 forbidden_admin_only). */
export function assertManager(ctx: RequestContext): void {
  if (!isManagerRole(ctx.role)) throw new AppError('forbidden_admin_only', 403);
}
