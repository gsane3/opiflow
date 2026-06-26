import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';
import { AppError, handleApiError } from '@/server/core/errors';
import { getBusinessMe, updateBusinessMe } from '@/server/modules/businesses/businesses.service';

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    // Membership-aware: resolves the owner OR any invited team member to their
    // business (falls back to owner_id for legacy businesses).
    const resolved = await resolveBusinessContext(supabase, user.id);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    try {
      const result = await getBusinessMe(supabase, resolved.businessId);
      return NextResponse.json({
        ok: true,
        business: result.business,
        phoneAssigned: result.phoneAssigned,
        activationAllowed: result.activationAllowed,
        billingConfigured: result.billingConfigured,
        subscription: result.subscription,
        numberRequest: result.numberRequest,
      });
    } catch (err) {
      if (err instanceof AppError) return handleApiError(err);
      throw err;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
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

    try {
      const updatedBusiness = await updateBusinessMe(supabase, user.id, raw);
      return NextResponse.json({ ok: true, business: updatedBusiness });
    } catch (err) {
      if (err instanceof AppError) return handleApiError(err);
      throw err;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }
}
