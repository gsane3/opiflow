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

function parseFormBody(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

type Summary = Record<string, string | number | boolean | null>;

function extractSummary(src: unknown): Summary {
  // Apifon callback payload shape is not confirmed yet.
  // Fields are probed at common top-level keys and camelCase variants.
  // Full schema mapping and persistence come when the actual payload shape is confirmed.
  return {
    request_id:   safeScalar(safeField(src, 'request_id'))   ?? safeScalar(safeField(src, 'requestId'))   ?? null,
    message_id:   safeScalar(safeField(src, 'message_id'))   ?? safeScalar(safeField(src, 'messageId'))   ?? null,
    custom_id:    safeScalar(safeField(src, 'custom_id'))    ?? safeScalar(safeField(src, 'customId'))    ?? null,
    reference:    safeScalar(safeField(src, 'reference'))                                                  ?? null,
    recipient:    safeStr(safeField(src, 'recipient'))
                  ?? safeStr(safeField(src, 'number'))
                  ?? safeStr(safeField(src, 'msisdn'))                                                     ?? null,
    status:       safeScalar(safeField(src, 'status'))                                                     ?? null,
    status_code:  safeScalar(safeField(src, 'status_code'))  ?? safeScalar(safeField(src, 'statusCode'))  ?? null,
    description:  safeStr(safeField(src, 'description'))                                                   ?? null,
    event_type:   safeScalar(safeField(src, 'event_type'))   ?? safeScalar(safeField(src, 'eventType'))   ?? null,
    delivered_at: safeStr(safeField(src, 'delivered_at'))    ?? safeStr(safeField(src, 'deliveredAt'))    ?? null,
    seen_at:      safeStr(safeField(src, 'seen_at'))         ?? safeStr(safeField(src, 'seenAt'))         ?? null,
    read_at:      safeStr(safeField(src, 'read_at'))         ?? safeStr(safeField(src, 'readAt'))         ?? null,
    timestamp:    safeScalar(safeField(src, 'timestamp'))                                                  ?? null,
    created_at:   safeStr(safeField(src, 'created_at'))      ?? safeStr(safeField(src, 'createdAt'))      ?? null,
    updated_at:   safeStr(safeField(src, 'updated_at'))      ?? safeStr(safeField(src, 'updatedAt'))      ?? null,
  };
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

  // If the payload is an array, extract summary from the first element.
  // array_count is included in summary so the shape can be confirmed during testing.
  let extractFrom: unknown = body;
  let arrayCount: number | null = null;
  if (Array.isArray(body)) {
    arrayCount = body.length;
    extractFrom = body.length > 0 ? body[0] : {};
  }

  const summary: Summary = extractSummary(extractFrom);
  if (arrayCount !== null) {
    summary['array_count'] = arrayCount;
  }

  return NextResponse.json({ ok: true, received: true, summary });
}
