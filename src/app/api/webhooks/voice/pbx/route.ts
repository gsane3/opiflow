// PBX post-call webhook receiver for the Inter Telecom/Asterisk PoC.
// Machine-to-machine route: no user auth token required.
// Stores raw call-completed events into provider_webhook_events (003_crm_core.sql).
// Business isolation and transcription pipeline are handled in later phases.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/webhooks/voice/pbx -- health check
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'pbx_call_completed_webhook' });
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/voice/pbx -- receive PBX call-completed event
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Shared secret guard. Set PBX_WEBHOOK_SECRET in env to require the header.
  // Leave unset during local/dev PoC to allow unauthenticated requests through.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (headerSecret !== webhookSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  // Read raw body before parse -- preserves option for future HMAC verification.
  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!isRecord(parsed)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Extract idempotency key: prefer event_id, fall back to call_id, else null.
  const eventId =
    getString(parsed['event_id']) ??
    getString(parsed['call_id']) ??
    null;

  // event_type defaults to 'call.completed' if absent from payload.
  const eventType = getString(parsed['event_type']) ?? 'call.completed';

  // Initialise Supabase service-role client.
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }

  try {
    // Idempotency check: if event_id is known, skip duplicate inserts.
    // The partial unique index (provider, event_id) WHERE event_id IS NOT NULL
    // also enforces this at the DB level, but a pre-check avoids a confusing
    // unique-constraint error on the client.
    if (eventId !== null) {
      const { data: existing } = await supabase
        .from('provider_webhook_events')
        .select('id')
        .eq('provider', 'pbx')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ ok: true, received: true, duplicate: true });
      }
    }

    // Insert raw event. provider is always 'pbx' regardless of payload content.
    const { error: insertError } = await supabase
      .from('provider_webhook_events')
      .insert({
        provider: 'pbx',
        event_id: eventId,
        event_type: eventType,
        payload: parsed,
        processed: false,
      });

    if (insertError) {
      return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, received: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }
}
