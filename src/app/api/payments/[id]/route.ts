// PATCH /api/payments/[id] — owner confirms (or cancels) a payment request.
// Authenticated business API; service-role client scoped by business_id. The
// transition is ATOMIC (`.not(status in final)` + select) so confirming twice
// can't double-apply. 'confirmed' is the only authoritative state (the owner
// verified the deposit landed); the customer's earlier 'declared' is not.
// Requires migration 048.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { mapBusinessPayment, PAYMENT_REQUEST_COLUMNS, type PaymentRequestRow } from '@/lib/server/payments';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
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
    if (raw.status !== 'confirmed' && raw.status !== 'cancelled') {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }
    const status = raw.status;
    const now = new Date().toISOString();

    // Atomic: only transition from a non-final state (business-scoped). 0 rows ⇒
    // not found for this business OR already settled → generic 409.
    const { data, error } = await supabase
      .from('payment_requests')
      .update({
        status,
        updated_at: now,
        ...(status === 'confirmed' ? { confirmed_at: now } : {}),
      })
      .eq('id', id)
      .eq('business_id', businessId)
      .not('status', 'in', '(confirmed,cancelled)')
      .select(PAYMENT_REQUEST_COLUMNS)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: 'payment_update_failed' }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: 'payment_not_actionable' }, { status: 409 });

    return NextResponse.json({ ok: true, payment: mapBusinessPayment(data as unknown as PaymentRequestRow) });
  } catch {
    return NextResponse.json({ ok: false, error: 'payment_update_failed' }, { status: 500 });
  }
}
