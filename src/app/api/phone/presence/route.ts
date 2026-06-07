// GET/PUT /api/phone/presence
//
// Per-user availability (available | busy | away | offline | dnd), used by call
// routing to decide ring-the-app vs. AI intake / voicemail. Stored in
// business_user_presence. Defensive: if migration 031 has not been applied, GET
// returns a safe default and PUT no-ops with degraded:true (never 500s).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

const VALID = ['available', 'busy', 'away', 'offline', 'dnd'] as const;
type Presence = (typeof VALID)[number];
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, userId, businessId } = auth.ctx;

  try {
    const { data } = await supabase
      .from('business_user_presence')
      .select('status, updated_at')
      .eq('user_id', userId)
      .eq('business_id', businessId)
      .maybeSingle();
    const status = (data as { status?: string } | null)?.status ?? 'available';
    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: true, status: 'available', degraded: true }, { headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, userId, businessId } = auth.ctx;

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  const status = (body.status ?? '').trim();
  if (!VALID.includes(status as Presence)) {
    return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400, headers: NO_STORE });
  }

  try {
    const { error } = await supabase
      .from('business_user_presence')
      .upsert(
        { user_id: userId, business_id: businessId, status, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,business_id' }
      );
    if (error) {
      return NextResponse.json({ ok: false, error: 'presence_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'presence_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
  }
}
