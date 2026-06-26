// GET/POST /api/businesses/me/bank-accounts — the business's bank accounts.
//
// ADOPTED to the modular pattern (src/server/modules/bank-accounts): thin adapter.
// Manager-gated (owner/admin only — IBANs must not leak to invited members). The IBAN
// validation + the tolerant lib calls (GET degrades to an empty list pre-051; writes
// surface bank_unavailable 503) live in the service. Responses byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser, assertManager } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { listAccounts, createAccount } from '@/server/modules/bank-accounts/bank-accounts.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
    assertManager(ctx);
  } catch (err) {
    return handleApiError(err);
  }
  const accounts = await listAccounts(ctx.businessId);
  return ok({ accounts });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
    assertManager(ctx);
  } catch (err) {
    return handleApiError(err);
  }

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
    const account = await createAccount(ctx.businessId, body as Record<string, unknown>);
    return ok({ account }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
