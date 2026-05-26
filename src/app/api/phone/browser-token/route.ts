import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// GET /api/phone/browser-token
//
// Returns browser SIP endpoint readiness metadata for the authenticated user's business.
// This route does NOT return a SIP password, provider credentials, or trunk details.
// No live SIP registration is possible in this slice. The response always contains
// ready: false until a future migration provisions real browser endpoint credentials.

type EndpointRow = {
  sip_username: string;
  status: string;
  wss_url: string | null;
  expires_at: string | null;
  last_issued_at: string | null;
};

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
    return NextResponse.json({ ok: false, error: 'phone_token_route_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    // Resolve the user's business. Following the pattern from /api/businesses/me.
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, business_phone_number')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (businessError) {
      return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500 });
    }
    if (!business) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    // Call the idempotent endpoint creation function via service-role RPC.
    // The function returns 0 rows if no active business_phone_numbers row exists.
    // It returns 1 row with endpoint metadata otherwise.
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'ensure_browser_sip_endpoint',
      {
        p_business_id: business.id,
        p_user_id: user.id,
      }
    );

    if (rpcError) {
      return NextResponse.json({ ok: false, error: 'endpoint_query_failed' }, { status: 500 });
    }

    const rows = rpcData as unknown as EndpointRow[];

    if (!Array.isArray(rows) || rows.length === 0) {
      // No active assigned number for this business. Cannot create a browser endpoint.
      return NextResponse.json({ ok: false, error: 'no_number_assigned' }, { status: 409 });
    }

    const row = rows[0];

    // Determine the readiness message.
    // In this slice, ready is always false. No SIP password is provisioned yet.
    // If a future migration activates the endpoint and sets wss_url, the message
    // switches to 'credentials_not_implemented' to signal the next required step.
    const isConfigured =
      row.status === 'active' && typeof row.wss_url === 'string' && row.wss_url.length > 0;
    const message = isConfigured ? 'credentials_not_implemented' : 'browser_endpoint_not_configured';

    return NextResponse.json({
      ok: true,
      ready: false,
      status: row.status,
      sipUsername: row.sip_username,
      wssUrl: row.wss_url ?? null,
      expiresAt: row.expires_at ?? null,
      message,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_token_route_failed' }, { status: 500 });
  }
}
