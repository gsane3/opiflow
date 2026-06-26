// PATCH /api/payments/[id] — owner confirms (or cancels) a payment request.
// Authenticated business API; service-role client scoped by business_id. The
// transition is ATOMIC (`.not(status in final)` + select) so confirming twice
// can't double-apply. 'confirmed' is the only authoritative state (the owner
// verified the deposit landed); the customer's earlier 'declared' is not.
// Requires migration 048.
//
// Adopted to the modular-monolith pattern (thin handler → payments.service):
// byte-identical response contract. The content-type gate stays route-side
// (BEFORE auth, like the original); JSON parsing stays route-side (invalid_json);
// validation + the atomic settle live in the service/repo, funnelled through
// handleApiError.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { handleApiError, ok } from '@/server/core/errors';
import { updatePaymentRequest } from '@/server/modules/payments/payments.service';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const ctx = await requireBusinessUser(request);
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const payment = await updatePaymentRequest(ctx, id, raw);
    return ok({ payment });
  } catch (err) {
    return handleApiError(err);
  }
}
