// PATCH/DELETE /api/businesses/me/bank-accounts/[id] — update or remove one bank account.
//
// ADOPTED to the modular pattern (src/server/modules/bank-accounts): thin adapter.
// Manager-gated; the IBAN validation, not_found (404) for a missing/other-tenant id,
// and the tolerant lib calls (bank_unavailable 503 pre-051) live in the service. Each
// mutation re-syncs the primary account into businesses.bank_* (inside the lib). Byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser, assertManager } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { updateAccount, deleteAccount } from '@/server/modules/bank-accounts/bank-accounts.service';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
    assertManager(ctx);
  } catch (err) {
    return handleApiError(err);
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const account = await updateAccount(ctx.businessId, id, body as Record<string, unknown>);
    return ok({ account });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
    assertManager(ctx);
  } catch (err) {
    return handleApiError(err);
  }
  const { id } = await params;
  try {
    await deleteAccount(ctx.businessId, id);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
