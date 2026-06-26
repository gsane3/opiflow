// In-app (browser/jsSIP/native) call logger with AI-brief parity.
//
// ADOPTED to the modular pattern (src/server/modules/calls): thin adapter. The
// direction/status validation, phone normalization, customer matching, the
// provider-id finalise-or-insert, and the factual summary live in the service/repo.
// Responses are byte-identical ({ ok, communicationId, brief:null }).

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { logCall } from '@/server/modules/calls/calls.service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
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
    const result = await logCall(ctx, body as Record<string, unknown>);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
