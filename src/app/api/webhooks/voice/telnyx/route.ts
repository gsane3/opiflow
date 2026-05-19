// First integration endpoint for Telnyx Voice API webhooks.
// Receives, verifies signatures, and acknowledges webhook events only.
// No database writes here. Call persistence and event routing come in a later phase.

import { NextRequest, NextResponse } from 'next/server';
import { createPublicKey, verify as cryptoVerify } from 'crypto';

export const runtime = 'nodejs';

// Ed25519 DER SPKI prefix for Node.js crypto key import.
// Telnyx provides the public key as a 32-byte hex-encoded raw Ed25519 key.
// Prepending this prefix wraps it into a SubjectPublicKeyInfo DER structure
// that Node.js crypto.createPublicKey can import without extra packages.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

type Ed25519Result =
  | { ok: true }
  | { ok: false; error: 'unsupported_key_format' | 'signature_invalid' | 'verify_error' };

function verifyEd25519(
  rawBody: string,
  timestamp: string,
  sigHeader: string,
  publicKeyHex: string,
): Ed25519Result {
  try {
    const rawKeyBytes = Buffer.from(publicKeyHex, 'hex');
    if (rawKeyBytes.length !== 32) {
      return { ok: false, error: 'unsupported_key_format' };
    }
    const derKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKeyBytes]);
    const publicKey = createPublicKey({ key: derKey, format: 'der', type: 'spki' });
    // Telnyx signing input: timestamp + "|" + rawBody
    const data = Buffer.from(`${timestamp}|${rawBody}`, 'utf8');
    const sig = Buffer.from(sigHeader, 'base64');
    const valid = cryptoVerify(null, data, publicKey, sig);
    return valid ? { ok: true } : { ok: false, error: 'signature_invalid' };
  } catch {
    return { ok: false, error: 'verify_error' };
  }
}

function safeStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeField(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'telnyx_voice_webhook' });
}

export async function POST(request: NextRequest) {
  const isStrict = process.env.TELNYX_WEBHOOK_VERIFY_STRICT === 'true';
  const publicKeyHex = process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? '';
  const sigHeader = request.headers.get('telnyx-signature-ed25519') ?? '';
  const timestamp = request.headers.get('telnyx-timestamp') ?? '';

  // Raw body must be read before JSON parsing so signature verification uses
  // the exact bytes Telnyx signed.
  const rawBody = await request.text();

  if (!rawBody) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
  }

  // Signature verification gate.
  if (!publicKeyHex) {
    if (isStrict) {
      // Key is required in strict mode. Configure TELNYX_WEBHOOK_PUBLIC_KEY.
      return NextResponse.json(
        { ok: false, error: 'telnyx_webhook_public_key_missing' },
        { status: 503 },
      );
    }
    // Non-strict with no key: allow through for initial local tunnel testing.
  } else if (sigHeader && timestamp) {
    const result = verifyEd25519(rawBody, timestamp, sigHeader, publicKeyHex);
    if (!result.ok) {
      // signature_invalid: always reject when key and headers are both present.
      // unsupported_key_format and verify_error: reject only in strict mode.
      const forceReject = result.error === 'signature_invalid' || isStrict;
      if (forceReject) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
      }
    }
  } else if (isStrict) {
    // Key is present but signature headers are missing: reject in strict mode.
    return NextResponse.json({ ok: false, error: 'missing_signature_headers' }, { status: 401 });
  }

  // Parse JSON body.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Extract safe summary fields from the Telnyx API v2 event structure:
  //   data.id, data.event_type, data.occurred_at
  //   data.payload.call_control_id, data.payload.connection_id
  //   data.payload.from, data.payload.to, data.payload.direction
  // Full extraction and persistence into calls / provider_webhook_events
  // tables are handled in a later phase.
  const eventId = safeStr(safeField(body, 'data', 'id'));
  const eventType = safeStr(safeField(body, 'data', 'event_type'));

  return NextResponse.json({
    ok: true,
    received: true,
    event_id: eventId ?? null,
    event_type: eventType ?? null,
  });
}
