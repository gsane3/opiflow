// Apifon Viber delivery and status callback receiver.
// Stores raw Apifon status events into provider_webhook_events and updates
// matching viber_messages rows (status, timestamps, raw payload) when found.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';

export const runtime = 'nodejs';

// user-agent is available via request.headers.get('user-agent') when needed for future logging.

function safeStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeScalar(value: unknown): string | number | boolean | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}

function safeField(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Returns payload.data[0] if data is a non-empty array whose first element is an object.
// Confirmed Apifon shape: { request_id, data: [{ message_id, status: { code, text }, ... }], account_id, type }
function getFirstDataObject(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  const data = payload['data'];
  if (!Array.isArray(data) || data.length === 0) return undefined;
  return isRecord(data[0]) ? data[0] : undefined;
}

function parseFormBody(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

type Summary = Record<string, string | number | boolean | null>;

function extractSummary(root: unknown): Summary {
  // Use data[0] for message-level fields when the confirmed Apifon envelope shape is present.
  // Fall back to root directly for generic or unrecognised payload shapes.
  const msg = getFirstDataObject(root);
  const src = msg ?? root;

  // Top-level envelope fields (root only).
  const request_id = safeScalar(safeField(root, 'request_id')) ?? null;
  const account_id = safeScalar(safeField(root, 'account_id')) ?? null;
  const type       = safeStr(safeField(root, 'type'))          ?? null;

  // array_count from root.data when it is an array.
  let array_count: number | null = null;
  if (isRecord(root) && Array.isArray(root['data'])) {
    array_count = (root['data'] as unknown[]).length;
  }

  // Message-level fields from data[0] when present, otherwise from root.
  const message_id  = safeScalar(safeField(src, 'message_id'))  ?? safeScalar(safeField(src, 'messageId'))  ?? null;
  const custom_id   = safeScalar(safeField(src, 'custom_id'))   ?? safeScalar(safeField(src, 'customId'))   ?? null;
  const from_sender = safeStr(safeField(src, 'from'))                                                       ?? null;
  const recipient   = safeStr(safeField(src, 'to'))
                      ?? safeStr(safeField(src, 'recipient'))
                      ?? safeStr(safeField(src, 'number'))
                      ?? safeStr(safeField(src, 'msisdn'))                                                   ?? null;

  // status.text (confirmed nested shape) with fallback to status as a direct scalar.
  const status      = safeStr(safeField(src, 'status', 'text'))
                      ?? safeScalar(safeField(src, 'status'))                                                ?? null;

  // status.code (confirmed nested shape) with fallback to status_code as a direct field.
  const status_code = safeScalar(safeField(src, 'status', 'code'))
                      ?? safeScalar(safeField(src, 'status_code'))
                      ?? safeScalar(safeField(src, 'statusCode'))                                            ?? null;

  const price        = safeScalar(safeField(src, 'price'))                                                  ?? null;
  const vat          = safeScalar(safeField(src, 'vat'))                                                    ?? null;
  const timestamp    = safeScalar(safeField(src, 'timestamp'))                                              ?? null;
  const delivered_at = safeStr(safeField(src, 'delivered_at')) ?? safeStr(safeField(src, 'deliveredAt'))   ?? null;
  const seen_at      = safeStr(safeField(src, 'seen_at'))      ?? safeStr(safeField(src, 'seenAt'))        ?? null;
  const read_at      = safeStr(safeField(src, 'read_at'))      ?? safeStr(safeField(src, 'readAt'))        ?? null;

  // Retained for fallback compatibility with other payload shapes.
  const reference   = safeScalar(safeField(src, 'reference'))                                               ?? null;
  const description = safeStr(safeField(src, 'description'))                                                ?? null;
  const event_type  = safeScalar(safeField(src, 'event_type')) ?? safeScalar(safeField(src, 'eventType'))  ?? null;

  const summary: Summary = {
    request_id,
    account_id,
    type,
    message_id,
    custom_id,
    from: from_sender,
    recipient,
    status,
    status_code,
    price,
    vat,
    timestamp,
    delivered_at,
    seen_at,
    read_at,
    reference,
    description,
    event_type,
  };

  if (array_count !== null) {
    summary['array_count'] = array_count;
  }

  return summary;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

interface ViberMessageMatch {
  id: string;
  business_id: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  communication_id: string | null;
}

const VIBER_MATCH_COLUMNS = 'id, business_id, delivered_at, failed_at, communication_id';

async function findViberMessageRow(
  supabase: SupabaseClient,
  msgId: string | null,
  reqId: string | null,
  refId: string | null
): Promise<ViberMessageMatch | null> {
  if (msgId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('provider', 'apifon')
      .eq('provider_message_id', msgId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  if (reqId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('provider', 'apifon')
      .eq('provider_request_id', reqId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  if (refId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('reference_id', refId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  return null;
}

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

    // Build a deterministic event_id: request_id + message_id + status_code.
    // Different status events for the same message have different status_code values,
    // so this key is unique per status transition.
    const reqIdStr = typeof summary.request_id === 'string' ? summary.request_id : '';
    const msgIdStr = summary.message_id !== null && summary.message_id !== undefined
      ? String(summary.message_id) : '';
    const scodeStr = summary.status_code !== null && summary.status_code !== undefined
      ? String(summary.status_code) : '';
    const rawEventId = [reqIdStr, msgIdStr, scodeStr].filter(s => s.length > 0).join(':');
    const apifonEventId = rawEventId.length > 0 ? rawEventId : null;

    // Idempotency: skip insert if this exact event was already stored.
    let providerEventId: string | null = null;
    if (apifonEventId) {
      const { data: existing } = await supabase
        .from('provider_webhook_events')
        .select('id')
        .eq('provider', 'apifon')
        .eq('event_id', apifonEventId)
        .maybeSingle();
      if (existing) {
        providerEventId = (existing as unknown as { id: string }).id;
      }
    }

    if (!providerEventId) {
      const eventTypeStr = typeof summary.type === 'string' ? summary.type : 'viber_status';
      const { data: inserted } = await supabase
        .from('provider_webhook_events')
        .insert({
          provider: 'apifon',
          event_id: apifonEventId,
          event_type: eventTypeStr,
          payload: root,
          processed: false,
        })
        .select('id')
        .single();
      if (inserted) {
        providerEventId = (inserted as unknown as { id: string }).id;
      }
    }

    // Find matching viber_messages row using a priority fallback chain:
    // provider_message_id > provider_request_id > reference_id.
    const msgIdForMatch = typeof summary.message_id === 'string' ? summary.message_id : null;
    const reqIdForMatch = typeof summary.request_id === 'string' ? summary.request_id : null;
    // summary.reference echoes the reference_id sent in the Apifon request body.
    const refIdForMatch = typeof summary.reference === 'string' ? summary.reference : null;

    const viberRow = await findViberMessageRow(
      supabase,
      msgIdForMatch,
      reqIdForMatch,
      refIdForMatch
    );

    if (viberRow) {
      const statusText = typeof summary.status === 'string' ? summary.status : null;
      const statusCode = summary.status_code !== null && summary.status_code !== undefined
        ? String(summary.status_code) : null;
      const statusLower = statusText?.toLowerCase() ?? '';
      const isDelivered = ['delivered', 'seen', 'read'].includes(statusLower);
      const isFailed = [
        'failed', 'rejected', 'undelivered', 'error', 'not_delivered',
      ].includes(statusLower);
      const normalizedStatus = isDelivered ? 'delivered'
        : isFailed ? 'failed'
        : (statusText ?? 'unknown');

      const now = new Date().toISOString();
      const viberUpdate: Record<string, unknown> = {
        status: normalizedStatus,
        status_code: statusCode,
        status_text: statusText,
        raw_status_payload: root,
        last_provider_event_id: providerEventId,
        updated_at: now,
      };

      // Set delivered_at only on first delivery event.
      if (isDelivered && !viberRow.delivered_at) {
        viberUpdate.delivered_at = now;
      }
      // Set failed_at only on first failure event.
      if (isFailed && !viberRow.failed_at) {
        viberUpdate.failed_at = now;
      }

      await supabase
        .from('viber_messages')
        .update(viberUpdate)
        .eq('id', viberRow.id);

      // Propagate status onto the linked timeline row (communications) so the
      // customer timeline reflects delivered / seen / failed (#57). Best-effort,
      // and guarded with .in('status', allowedPrior) so a late/out-of-order event
      // never regresses a higher status (e.g. seen -> delivered).
      if (viberRow.communication_id) {
        let commStatus: 'delivered' | 'seen' | 'failed' | null = null;
        let allowedPrior: string[] = [];
        if (statusLower === 'seen' || statusLower === 'read') {
          commStatus = 'seen';
          allowedPrior = ['started', 'sent', 'delivered'];
        } else if (isDelivered) {
          commStatus = 'delivered';
          allowedPrior = ['started', 'sent'];
        } else if (isFailed) {
          commStatus = 'failed';
          allowedPrior = ['started', 'sent', 'delivered'];
        }
        if (commStatus) {
          try {
            // Tenant-scope the update by the matched viber_messages row's
            // business_id (defense-in-depth: the status propagation must never
            // be able to touch a communications row outside that tenant).
            let commUpdate = supabase
              .from('communications')
              .update({ status: commStatus })
              .eq('id', viberRow.communication_id)
              .in('status', allowedPrior);
            if (viberRow.business_id) {
              commUpdate = commUpdate.eq('business_id', viberRow.business_id);
            }
            await commUpdate;
          } catch {
            // best-effort: status propagation must not affect the 200 to Apifon
          }
        }
      }

      // Mark provider event processed once viber_messages is updated.
      if (providerEventId) {
        await supabase
          .from('provider_webhook_events')
          .update({ processed: true, processed_at: now })
          .eq('id', providerEventId);
      }

      matched = true;
    }
  } catch {
    // DB errors are non-fatal for Apifon status callbacks.
  }

  return NextResponse.json({ ok: true, received: true, summary, matched });
}
