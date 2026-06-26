// Apifon Viber delivery and status callback receiver.
// Stores raw Apifon status events into provider_webhook_events and updates
// matching viber_messages rows (status, timestamps, raw payload) when found.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';
import {
  extractSummary,
  parseFormBody,
  processApifonStatus,
} from '@/server/modules/webhooks-other/webhooks-other.service';

export const runtime = 'nodejs';

// user-agent is available via request.headers.get('user-agent') when needed for future logging.

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'apifon_status_webhook' });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';

  // Raw body must be read before parsing.
  const rawBody = await request.text();

  if (!rawBody) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
  }

  // Optional shared secret guard for local tunnel testing.
  // Set APIFON_WEBHOOK_SECRET in .env.local to restrict access.
  // Leave unset to allow all requests during initial integration testing.
  const webhookSecret = process.env.APIFON_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret') ?? '';
    const headerSecret = request.headers.get('x-apifon-webhook-secret') ?? '';
    if (!timingSafeEqualSecret(querySecret, webhookSecret) && !timingSafeEqualSecret(headerSecret, webhookSecret)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
    console.error('[apifon status webhook] APIFON_WEBHOOK_SECRET is not set in production — rejecting. Set the secret (or ALLOW_INSECURE_WEBHOOKS=1 to override).');
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  } else {
    console.warn('[apifon status webhook] APIFON_WEBHOOK_SECRET is not set — endpoint is UNAUTHENTICATED.');
  }

  // Parse body based on content-type.
  let body: unknown;
  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    body = parseFormBody(rawBody);
  } else {
    // Unknown content-type: attempt JSON, fall back to a raw-received marker.
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = { raw_received: true };
    }
  }

  // If body itself is an array, wrap it so extractSummary can treat it uniformly
  // via the root.data[] path. This preserves backward compatibility.
  const root: unknown = Array.isArray(body) ? { data: body } : body;

  const summary = extractSummary(root);

  // ---------------------------------------------------------------------------
  // Persist to DB (non-fatal: errors here do not affect the 200 response to Apifon).
  // ---------------------------------------------------------------------------
  let matched = false;

  try {
    const supabase = createServerSupabaseClient();
    matched = await processApifonStatus(supabase, summary, root);
  } catch {
    // DB errors are non-fatal for Apifon status callbacks.
  }

  return NextResponse.json({ ok: true, received: true, summary, matched });
}
