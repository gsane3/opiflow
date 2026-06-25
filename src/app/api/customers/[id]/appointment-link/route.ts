// POST /api/customers/[id]/appointment-link
// Builds a Viber appointment response link for a customer.
//
// mode='draft' (default):
//   Creates a new appointment response token, returns responseUrl + message +
//   recipient without calling Apifon. Adds a warning when due_date or due_time
//   is missing.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   appointment_response_tokens (scoped to this task and business, must not
//   be revoked or expired). Uses the verified canonical URL.
//   If responseUrl is absent: creates a fresh token as fallback.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel (Viber with SMS fallback, or SMS direct). The message
//   TEXT always carries the response URL so SMS delivers a usable link.
//
// Thin adapter: requireBusinessUser → parse body → buildAppointmentLink → error-map.
// All domain logic lives in the customer-links service.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { AppError, handleApiError } from '@/server/core/errors';
import { buildAppointmentLink } from '@/server/modules/customer-links/customer-links.service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const ctx = await requireBusinessUser(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_body', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    const { id: customerId } = await params;

    const { payload, status } = await buildAppointmentLink(ctx, customerId, raw);
    return NextResponse.json({ ok: true, ...payload }, { status });
  } catch (err) {
    return handleApiError(err);
  }
}
