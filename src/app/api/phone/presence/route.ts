// GET/PUT /api/phone/presence
//
// Per-user availability (available | busy | away | offline | dnd), used by call
// routing to decide ring-the-app vs. AI intake / voicemail. Stored in
// business_user_presence. Defensive: if migration 031 has not been applied, GET
// returns a safe default and PUT no-ops with degraded:true (never 500s).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { readPresence, validatePresence, writePresence } from '@/server/modules/phone/phone.service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, userId, businessId } = auth.ctx;

  try {
    const status = await readPresence(supabase, userId, businessId);
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
  const validated = validatePresence(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE });
  }
  const { status } = validated;

  try {
    const { error } = await writePresence(supabase, userId, businessId, status);
    if (error) {
      return NextResponse.json({ ok: false, error: 'presence_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'presence_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
  }
}
