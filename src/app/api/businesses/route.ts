// POST /api/businesses — business onboarding/signup.
//
// ADOPTED to the modular pattern (src/server/modules/businesses/businesses-create.ts):
// the route keeps the content-type 415 guard, the bespoke Bearer + getUser auth VERBATIM
// (the caller has NO business yet, so requireBusinessUser can't be used) and the outer
// business_create_failed catch-all; the field validation + create/rollback orchestration
// live in the service. Byte-identical: same codes, status codes and JSON shape.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { assignPhoneNumber } from '@/lib/server/phone-number-pool';
import { AppError } from '@/server/core/errors';
import { createBusinessForOwner } from '@/server/modules/businesses/businesses-create';

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const result = await createBusinessForOwner(supabase, user.id, raw, { assignPhoneNumber });

    return NextResponse.json({
      ok: true,
      business: result.business,
      phoneAssigned:      result.phoneAssigned,
      subscriptionStatus: result.subscriptionStatus,
      ...(result.numberRequest !== null ? { numberRequest: result.numberRequest } : {}),
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
  }
}
