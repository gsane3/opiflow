// GET   /api/customers/[id]/next-action  → { ok, action: ClientNextAction | null }
// PATCH /api/customers/[id]/next-action   → mark the active action accepted|dismissed|snooze|complete
//
// ADOPTED to the modular pattern (src/server/modules/next-action): thin adapter. The
// compute (tolerant of a pending migration 054 → null) and the lifecycle validation
// (invalid_body) live in the service; the PATCH returns the lib's boolean ok verbatim.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getNextAction, applyNextAction } from '@/server/modules/next-action/next-action.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id: customerId } = await params;
  const action = await getNextAction(ctx, customerId);
  return ok({ action });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail('unsupported_content_type', 415);
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_body', 400);
  }
  if (typeof body !== 'object' || body === null) return fail('invalid_body', 400);

  try {
    const result = await applyNextAction(ctx, body as Record<string, unknown>);
    return NextResponse.json({ ok: result });
  } catch (err) {
    return handleApiError(err);
  }
}
