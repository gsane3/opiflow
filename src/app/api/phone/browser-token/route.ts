import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// GET /api/phone/browser-token
//
// Returns browser SIP credentials for the authenticated user's business.
// Credentials are read from server-side environment variables only:
//   PHONE_SIP_WSS_URL, PHONE_SIP_USERNAME, PHONE_SIP_PASSWORD, PHONE_SIP_REALM
//
// Gate logic:
//   1. Bearer token required.
//   2. Supabase getUser(token) must succeed.
//   3. Business must exist (owner_id match).
//   4. business.business_phone_number must be set -- used as the "number assigned" gate.
//   5. ensure_browser_sip_endpoint is called best-effort; RPC errors are non-fatal.
//   6. SIP credentials are read from env after all ownership checks pass.
//
// sipPassword is returned only after auth and business checks pass.
// It is never logged or included in error responses.

// Cache-Control applied to every response: credentials must not be cached.
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { ok: false, error: 'missing_auth' },
      { status: 401, headers: NO_STORE }
    );
  }
  const token = authHeader.slice(7);

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json(
        { ok: false, error: 'missing_supabase_config' },
        { status: 503, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'phone_token_route_failed' },
      { status: 500, headers: NO_STORE }
    );
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: 'invalid_auth' },
        { status: 401, headers: NO_STORE }
      );
    }

    // Resolve the user's business.
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, business_phone_number')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (businessError) {
      return NextResponse.json(
        { ok: false, error: 'business_query_failed' },
        { status: 500, headers: NO_STORE }
      );
    }
    if (!business) {
      return NextResponse.json(
        { ok: false, error: 'business_not_found' },
        { status: 404, headers: NO_STORE }
      );
    }

    // Gate: business must have an assigned phone number.
    // This check replaces the RPC-row count used previously.
    if (!business.business_phone_number) {
      return NextResponse.json(
        { ok: false, error: 'no_number_assigned' },
        { status: 409, headers: NO_STORE }
      );
    }

    // Best-effort: create/update the browser SIP endpoint row in the DB.
    // RPC errors are non-fatal for this PoC -- env-based credentials are used regardless.
    try {
      await supabase.rpc('ensure_browser_sip_endpoint', {
        p_business_id: business.id,
        p_user_id: user.id,
      });
    } catch {
      // Intentionally swallowed. The RPC is a bookkeeping step;
      // credential delivery does not depend on it for the env-var PoC path.
    }

    // Auth and business ownership checks passed. Read SIP credentials from env.
    // Values are never logged.
    const sipWssUrl = process.env.PHONE_SIP_WSS_URL?.trim() || null;
    const sipUsername = process.env.PHONE_SIP_USERNAME?.trim() || null;
    const sipPassword = process.env.PHONE_SIP_PASSWORD?.trim() || null;
    const sipRealm = process.env.PHONE_SIP_REALM?.trim() || null;

    const credentialsReady =
      sipWssUrl !== null && sipUsername !== null && sipPassword !== null;

    if (credentialsReady) {
      return NextResponse.json(
        {
          ok: true,
          ready: true,
          sipUsername,
          sipRealm,
          wssUrl: sipWssUrl,
          sipPassword,
          expiresAt: null,
          message: 'browser_endpoint_ready',
        },
        { headers: NO_STORE }
      );
    }

    // Credentials not yet configured in env. Return a safe not-ready response.
    return NextResponse.json(
      {
        ok: true,
        ready: false,
        message: 'browser_endpoint_not_configured',
      },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'phone_token_route_failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}
