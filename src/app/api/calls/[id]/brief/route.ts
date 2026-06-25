// GET /api/calls/[id]/brief
//
// ADOPTED to the modular pattern (src/server/modules/calls): thin adapter. Powers the
// post-call card: the tolerant comm fetch (pre-migration brief_created_at fallback), the
// transcript-brief pick, the customer-name lookup, and the brief-text-derived suggested
// actions live in the service. Byte-identical: not_found (404), server_error (500),
// ready/briefKind/summary + the full payload.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { getCallBrief } from '@/server/modules/calls/calls.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id } = await params;
    const result = await getCallBrief(ctx, id);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
