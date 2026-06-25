// GET/PATCH /api/businesses/me/bank — the business's bank-transfer details
// (beneficiary / bank / IBAN), shown to the customer on the portal payment card
// and the offer PDF. DELIBERATELY SEPARATE from /api/businesses/me so the new
// columns never touch the login/onboarding-critical select: that route's allowlist
// stays unchanged, and this endpoint reads/writes the bank columns TOLERANTLY
// (pre-migration-048 the columns are absent → GET returns nulls, PATCH 503s) so
// nothing here can break sign-in. Authenticated + business_id-scoped (service-role).

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { handleApiError } from '@/server/core/errors';
import { getBank, updateBank } from '@/server/modules/businesses/businesses.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    const bank = await getBank(ctx.supabase, ctx.businessId);
    return NextResponse.json({ ok: true, bank });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest) {
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
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const bank = await updateBank(ctx.businessId, raw);
    return NextResponse.json({ ok: true, bank });
  } catch (err) {
    return handleApiError(err);
  }
}
