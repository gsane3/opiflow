// First integration endpoint for Apifon Viber delivery and status callbacks.
// Receives and acknowledges webhook events only.
// No database writes here. Viber message persistence comes in a later phase.

import { NextRequest, NextResponse } from 'next/server';

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
    if (querySecret !== webhookSecret && headerSecret !== webhookSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
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

  return NextResponse.json({ ok: true, received: true, summary });
}
