import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';
import { isEntitled } from '@/lib/billing/entitlement';

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

async function resolveAuth(request: NextRequest): Promise<
  | { ok: true; token: string; supabase: ReturnType<typeof createServerSupabaseClient> }
  | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }),
    };
  }
  const token = authHeader.slice(7);

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'missing_supabase_config' },
          { status: 503 }
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'number_request_route_failed' },
        { status: 500 }
      ),
    };
  }

  return { ok: true, token, supabase };
}

// ---------------------------------------------------------------------------
// GET /api/number-requests
// ---------------------------------------------------------------------------
// Returns the current pending phone number request for the authenticated user's
// business. Safe fields only: status, requestedCity, createdAt.

export async function GET(request: NextRequest) {
  const auth = await resolveAuth(request);
  if (!auth.ok) return auth.response;
  const { token, supabase } = auth;

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    // Membership-aware (not owner_id) so invited team members resolve too.
    const resolved = await resolveBusinessContext(supabase, user.id);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }
    const biz = { id: resolved.businessId };

    const { data: reqRow } = await supabase
      .from('phone_number_requests')
      .select('status, requested_city, created_at')
      .eq('business_id', biz.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const req = reqRow as {
      status:         string;
      requested_city: string | null;
      created_at:     string;
    } | null;

    return NextResponse.json({
      ok: true,
      numberRequest: req
        ? {
            status:        req.status,
            requestedCity: req.requested_city ?? null,
            createdAt:     req.created_at,
          }
        : null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'number_request_route_failed' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/number-requests
// ---------------------------------------------------------------------------
// Ensures a pending phone number request exists for the authenticated user's
// business. Idempotent: returns the existing request if one is already pending.
//
// Guards:
//   - Bearer token required.
//   - Business must exist.
//   - If business_phone_number is already assigned, returns status 'already_assigned'.
//   - Subscription must allow access (pending_manual_review, trialing, or active).
//
// Does not allocate a phone number, send provider messages, or expose admin data.

export async function POST(request: NextRequest) {
  const auth = await resolveAuth(request);
  if (!auth.ok) return auth.response;
  const { token, supabase } = auth;

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    // Membership-aware (not owner_id) so invited team members resolve too.
    const resolved = await resolveBusinessContext(supabase, user.id);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id, city, business_phone_number')
      .eq('id', resolved.businessId)
      .maybeSingle();

    if (bizError) {
      return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500 });
    }
    if (!business) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const biz = business as {
      id:                   string;
      city:                 string | null;
      business_phone_number: string | null;
    };

    // Number already assigned: no request needed.
    if (biz.business_phone_number) {
      return NextResponse.json({ ok: true, status: 'already_assigned' });
    }

    // Activation guard: only allowed subscription statuses may request a number.
    const { data: subRow } = await supabase
      .from('business_subscriptions')
      .select('status')
      .eq('business_id', biz.id)
      .maybeSingle();

    const subStatus = subRow ? (subRow as { status: string }).status : null;
    const activationAllowed = isEntitled(subStatus);

    if (!activationAllowed) {
      return NextResponse.json(
        { ok: false, error: 'activation_required' },
        { status: 403 }
      );
    }

    // Check for an existing pending request (idempotency).
    const { data: existing } = await supabase
      .from('phone_number_requests')
      .select('status, requested_city, created_at')
      .eq('business_id', biz.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      const ex = existing as {
        status:         string;
        requested_city: string | null;
        created_at:     string;
      };
      return NextResponse.json({
        ok: true,
        status:  'pending',
        created: false,
        numberRequest: {
          status:        ex.status,
          requestedCity: ex.requested_city ?? null,
          createdAt:     ex.created_at,
        },
      });
    }

    // Insert a new pending request.
    const requestedCity = biz.city ?? null;
    const { error: insertError } = await supabase
      .from('phone_number_requests')
      .insert({
        business_id:    biz.id,
        requested_city: requestedCity,
        source:         'number_page',
        status:         'pending',
      });

    if (insertError) {
      // Unique violation from the partial index means a concurrent insert just won.
      // Treat as a successful pending request rather than an error.
      if (
        insertError.code === '23505' ||
        (insertError.message ?? '').toLowerCase().includes('unique')
      ) {
        return NextResponse.json({
          ok:      true,
          status:  'pending',
          created: false,
          numberRequest: {
            status:        'pending',
            requestedCity,
            createdAt:     new Date().toISOString(),
          },
        });
      }
      return NextResponse.json(
        { ok: false, error: 'request_create_failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok:      true,
      status:  'pending',
      created: true,
      numberRequest: {
        status:        'pending',
        requestedCity,
        createdAt:     new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'number_request_route_failed' },
      { status: 500 }
    );
  }
}
