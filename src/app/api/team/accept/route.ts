// POST /api/team/accept  { token }
//
// ADOPTED to the modular pattern (src/server/modules/team): thin adapter. Unlike the
// other team routes it does NOT require the caller to already belong to a business, so
// it authenticates the bearer DIRECTLY (kept verbatim here — that custom auth must not
// change). The invite lookup/expiry/email-match/membership-upsert lives in the service.
// Responses byte-identical (incl. Cache-Control: no-store on every response).

import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken } from '@/lib/api/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { acceptInvite } from '@/server/modules/team/team.service';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  const bearer = getBearerToken(request);
  if (!bearer) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401, headers: NO_STORE });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  const rawToken = (body.token ?? '').trim();
  if (!rawToken) {
    return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400, headers: NO_STORE });
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 503, headers: NO_STORE });
  }

  // Identify the caller.
  let userId: string;
  let email: string | null;
  try {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401, headers: NO_STORE });
    }
    userId = data.user.id;
    email = (data.user.email ?? '').toLowerCase() || null;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401, headers: NO_STORE });
  }

  try {
    const result = await acceptInvite(supabase, userId, email, rawToken);
    if (result.ok) {
      return NextResponse.json({ ok: true, businessId: result.businessId, role: result.role }, { headers: NO_STORE });
    }
    if (result.error === 'wrong_account') {
      return NextResponse.json(
        { ok: false, error: 'wrong_account', invitedEmail: result.invitedEmail },
        { status: 403, headers: NO_STORE },
      );
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'accept_failed' }, { status: 500, headers: NO_STORE });
  }
}
