// PBX post-call webhook receiver for the Inter Telecom/Asterisk PoC.
// Machine-to-machine route: no user auth token required.
// Stores raw call-completed events into provider_webhook_events (003_crm_core.sql).
// Business isolation and transcription pipeline are handled in later phases.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateCallBrief } from '@/lib/server/call-brief';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';
import { isWithinBusinessHours, parseBusinessHours } from '@/lib/server/business-hours';
import {
  processPbxCallCompleted,
  resolvePbxBusinessId,
  type PbxInput,
} from '@/server/modules/webhooks-voice/webhooks-voice.service';

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

function getBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s;
}

/**
 * `biz_<32hex>` endpoint identity → business UUID. The PBX dials a per-tenant
 * app endpoint (biz_<hex>) for each business, so this is the most reliable
 * multi-tenant business identifier — no dependency on business_phone_numbers
 * data being populated. Mirrors the inbound Twilio webhook's hex→UUID mapping.
 */
function businessIdFromBizEndpoint(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/biz_([a-f0-9]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

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
  // Shared secret guard. Set PBX_WEBHOOK_SECRET to require the header. In
  // production the secret is mandatory (fail closed) unless ALLOW_INSECURE_WEBHOOKS=1
  // is set, so a misconfigured deploy cannot leave this customer-/Viber-writing
  // endpoint open to the internet.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (!timingSafeEqualSecret(headerSecret, webhookSecret)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
    console.error('[pbx webhook] PBX_WEBHOOK_SECRET is not set in production — rejecting. Set the secret (or ALLOW_INSECURE_WEBHOOKS=1 to override).');
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  } else {
    console.warn('[pbx webhook] PBX_WEBHOOK_SECRET is not set — endpoint is UNAUTHENTICATED.');
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
  const eventType = getString(parsed['event_type']) ?? getString(parsed['event']) ?? 'call.completed';

  const callerNumber = getString(parsed['caller_number']);
  const calledNumberRaw = getString(parsed['called_number']);
  // The PBX rang a known per-tenant app endpoint (biz_<hex>) — the most reliable
  // business identifier. Falls back to the dialed-DID lookup, then the env var.
  const bizEndpointId = businessIdFromBizEndpoint(
    getString(parsed['endpoint']) ?? getString(parsed['biz_id']) ?? getString(parsed['opiflow_ep'])
  );
  const pbxBusinessIdFromEnv = getString(process.env.PBX_BUSINESS_ID);
  // Require at least one source for business resolution before touching Supabase.
  if (!bizEndpointId && !calledNumberRaw && !pbxBusinessIdFromEnv) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

  const dialStatus = getString(parsed['dialstatus']);
  const uniqueId = getString(parsed['uniqueid']) ?? eventId;
  const recordingExists = getBoolean(parsed['recording_exists']);
  const recordingSizeBytes = getNumber(parsed['recording_size_bytes']);
  const recordingFallbackApplied = getBoolean(parsed['recording_fallback_applied']);
  const consentAnnounced = getBoolean(parsed['consent_announced']);

  // Initialise Supabase service-role client.
  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }

  const input: PbxInput = {
    parsed,
    eventId,
    eventType,
    callerNumber,
    bizEndpointId,
    calledNumberRaw,
    pbxBusinessIdFromEnv,
    dialStatus,
    uniqueId,
    recordingExists,
    recordingSizeBytes,
    recordingFallbackApplied,
    consentAnnounced,
  };

  // Resolve business_id: prefer called_number lookup (multi-tenant),
  // fall back to PBX_BUSINESS_ID env var (single-tenant / local PBX tests).
  const businessId = await resolvePbxBusinessId(supabase, input);

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

  return processPbxCallCompleted(supabase, businessId, input, {
    generateCallBrief,
    sendPushToBusinessOwner,
    sendViaPreferredChannel,
    extractProviderIds,
    recordOutboundMessage,
    isWithinBusinessHours,
    parseBusinessHours,
    normalizePhone,
  });
}
