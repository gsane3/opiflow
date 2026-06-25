// Authenticated API route for generating appointment response links.
// This route only creates a secure response link and returns it to the caller.
// It does not send any message, email, Viber, SMS, or external notification.
//
// ADOPTED to the modular pattern (src/server/modules/appointment-links): thin adapter.
// Validation (with the route's exact error codes + order), the appointment-task
// ownership/type/status check, and the token mint live in the service; the content-type
// gate, auth shell, and JSON parsing stay here. Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { createAppointmentResponseLink } from '@/server/modules/appointment-links/appointment-links.service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /api/appointment-response-links
// ---------------------------------------------------------------------------

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
    const result = await createAppointmentResponseLink(ctx, body as Record<string, unknown>);
    return ok({ responseUrl: result.responseUrl, token: result.token }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
