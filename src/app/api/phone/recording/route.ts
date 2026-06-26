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
import { authenticateBusinessRequest, requireManager } from '@/lib/api/auth';
import { readRecording, validateRecording, writeRecording } from '@/server/modules/phone/phone.service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const result = await readRecording(supabase, businessId);
    if (result.degraded) {
      // Missing column (pre-059) or any read error → default to recording ON.
      return NextResponse.json({ ok: true, recordCalls: true, degraded: true }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, recordCalls: result.recordCalls }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: true, recordCalls: true, degraded: true }, { headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  // Recording on/off is a consent/COGS setting — owner/admin only.
  const denied = requireManager(auth.ctx);
  if (denied) return denied;
  const { supabase, businessId } = auth.ctx;

  let body: { recordCalls?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  const validated = validateRecording(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE });
  }
  const recordCalls = validated.recordCalls;

  try {
    const result = await writeRecording(supabase, businessId, recordCalls);
    if (!result.ok) {
      if (result.migrationPending) {
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
