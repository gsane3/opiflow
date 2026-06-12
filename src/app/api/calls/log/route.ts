// In-app (browser/jsSIP) call logger with AI-brief parity.
//
// When a technician finishes a call in the app, the calls screen posts it here.
// This mirrors the PBX JSON webhook's enrichment for browser calls: it records
// the call as a `communications` row and attaches a metadata-only AI brief
// (review-first; no transcript) to the row's summary, exactly like the PBX path.
// The brief text itself contains the recommended next action.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { generateCallBrief } from '@/lib/server/call-brief';
import { appendCallBrief } from '@/lib/server/call-briefs';

export const runtime = 'nodejs';

const DIRECTIONS = ['inbound', 'outbound'] as const;
const STATUSES = ['completed', 'failed'] as const;
type Direction = (typeof DIRECTIONS)[number];
type Status = (typeof STATUSES)[number];

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const direction = (DIRECTIONS as readonly string[]).includes(raw.direction as string)
    ? (raw.direction as Direction)
    : null;
  const status = (STATUSES as readonly string[]).includes(raw.status as string)
    ? (raw.status as Status)
    : null;
  if (!direction || !status) {
    return NextResponse.json({ ok: false, error: 'invalid_call' }, { status: 400 });
  }

  const phone = normalizePhone(str(raw.phone));
  // Optional provider call id (e.g. Twilio CallSid for native calls). Lets the
  // recording webhook match this row exactly (provider_call_id, migration 038)
  // instead of scanning the summary text. Omitted for plain jsSIP browser calls.
  const providerCallId = str(raw.providerCallId);

  // Validate the (optional) customer belongs to this business; drop it otherwise
  // so a call can never be attributed across tenants.
  let customerId = str(raw.customerId);
  let customerMatched = false;
  if (customerId) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (data) {
      customerMatched = true;
    } else {
      customerId = null;
    }
  }

  // No explicit customer (e.g. the native dialer) → match by phone, the same
  // way the PBX inbound path does (match-only; never auto-create on outbound).
  // Lets the recording webhook's Deepgram brief + ai_draft task land on the
  // right customer's timeline.
  if (!customerId && phone) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      customerId = (data as { id: string }).id;
      customerMatched = true;
    }
  }

  const basicSummary =
    status === 'completed'
      ? direction === 'inbound'
        ? 'Εισερχόμενη κλήση'
        : 'Εξερχόμενη κλήση'
      : direction === 'inbound'
      ? 'Αποτυχημένη εισερχόμενη κλήση'
      : 'Αποτυχημένη εξερχόμενη κλήση';

  // Metadata-only AI brief (review-first; mirrors the PBX path). Non-fatal:
  // a missing key or model error just yields the basic summary.
  let brief: string | null = null;
  try {
    brief = await generateCallBrief({
      callerNumber: phone,
      direction,
      dialStatus: status === 'completed' ? 'ANSWERED' : 'FAILED',
      uniqueId: null,
      recordingExists: false,
      recordingSizeBytes: null,
      recordingFallbackApplied: null,
      customerCreated: false,
      customerMatched,
      intakeUrlCreated: false,
      viberSendStatus: null,
    });
  } catch {
    // non-fatal
  }

  const summary = brief ? `${brief}\n\n---\n${basicSummary}` : basicSummary;

  // Native calls are already logged SERVER-SIDE at dial time by the outbound
  // TwiML webhook (status 'started', provider_call_id = CallSid). When that row
  // exists, finalise it instead of inserting a duplicate — and never overwrite
  // a transcript brief the recording webhook may have already attached.
  if (providerCallId) {
    const { data: existing } = await supabase
      .from('communications')
      .select('id, customer_id, brief_created_at')
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .eq('provider_call_id', providerCallId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = existing as { id: string; customer_id: string | null; brief_created_at: string | null } | null;
    if (row) {
      const hasTranscriptBrief = Boolean(row.brief_created_at);
      await supabase
        .from('communications')
        .update({
          status,
          ...(hasTranscriptBrief ? {} : { summary }),
          ...(customerId && !row.customer_id ? { customer_id: customerId } : {}),
        })
        .eq('id', row.id)
        .eq('business_id', businessId);
      await appendCallBrief(supabase, {
        businessId,
        customerId: customerId ?? row.customer_id,
        communicationId: row.id,
        briefKind: 'metadata',
        briefText: summary,
      });
      return NextResponse.json({ ok: true, communicationId: row.id, brief: brief ?? null });
    }
  }

  const { data: commRow, error: commError } = await supabase
    .from('communications')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      channel: 'call',
      direction,
      status,
      phone,
      summary,
      // Only include provider_call_id when present, so the insert stays valid
      // on databases where migration 038 has not been applied yet.
      ...(providerCallId ? { provider_call_id: providerCallId } : {}),
    })
    .select('id')
    .single();

  if (commError || !commRow) {
    return NextResponse.json({ ok: false, error: 'call_log_failed' }, { status: 500 });
  }

  const communicationId = (commRow as { id: string }).id;

  // Append the metadata brief to the per-call brief timeline (non-fatal).
  await appendCallBrief(supabase, {
    businessId,
    customerId,
    communicationId,
    briefKind: 'metadata',
    briefText: summary,
  });

  return NextResponse.json({
    ok: true,
    communicationId,
    brief: brief ?? null,
  });
}
