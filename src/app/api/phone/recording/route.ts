// GET/PUT /api/phone/recording
//
// The business's "record calls" preference. When OFF, the outbound TwiML webhook
// (src/app/api/webhooks/voice/twilio/outbound/route.ts) skips Twilio recording +
// the Deepgram/OpenAI brief pipeline for that business — a COGS control and a
// consent/GDPR control. Stored on businesses.record_calls (boolean, default true).
//
// Defensive: if migration 059 has not been applied, GET returns the default
// (recordCalls:true, degraded:true) and PUT no-ops with degraded:true (never
// 500s, so the settings panel keeps rendering and the toggle stays usable).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Treat a PostgREST "column missing" error as "migration 059 not applied yet". */
function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || m.includes('record_calls');
}

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('record_calls')
      .eq('id', businessId)
      .maybeSingle();
    if (error) {
      // Missing column (pre-059) or any read error → default to recording ON.
      return NextResponse.json({ ok: true, recordCalls: true, degraded: true }, { headers: NO_STORE });
    }
    const rc = (data as { record_calls?: boolean | null } | null)?.record_calls;
    return NextResponse.json({ ok: true, recordCalls: rc !== false }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: true, recordCalls: true, degraded: true }, { headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  let body: { recordCalls?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.recordCalls !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'invalid_record_calls' }, { status: 400, headers: NO_STORE });
  }
  const recordCalls = body.recordCalls;

  try {
    const { error } = await supabase
      .from('businesses')
      .update({ record_calls: recordCalls, updated_at: new Date().toISOString() })
      .eq('id', businessId);
    if (error) {
      if (isMissingColumn(error)) {
        return NextResponse.json(
          { ok: false, recordCalls, error: 'migration_pending', degraded: true },
          { status: 200, headers: NO_STORE }
        );
      }
      return NextResponse.json({ ok: false, error: 'update_failed', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, recordCalls }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'update_failed', degraded: true }, { status: 200, headers: NO_STORE });
  }
}
