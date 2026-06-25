import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { recordOutboundMessage } from '@/lib/server/record-message';
import { sendOfferEmail } from '@/server/modules/email-send-offer/email-send-offer.service';

export const runtime = 'nodejs';

const EMAIL_SEND_MAX_BODY_BYTES = 32_000;

// MVP-only in-memory rate limiter. Resets on cold start; not shared across
// multiple serverless instances.
const EMAIL_SEND_RATE_LIMIT_MAX = 5;
const EMAIL_SEND_RATE_LIMIT_WINDOW_MS = 60_000;
const emailSendRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = emailSendRateLimitStore.get(ip);
  if (!entry || now >= entry.resetAt) {
    emailSendRateLimitStore.set(ip, { count: 1, resetAt: now + EMAIL_SEND_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= EMAIL_SEND_RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

export async function POST(req: NextRequest) {
  const auth = await authenticateBusinessRequest(req);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  if (isRateLimited(getClientIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const contentLengthRaw = req.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = parseInt(contentLengthRaw, 10);
    if (!isNaN(contentLength) && contentLength > EMAIL_SEND_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, error: 'missing_email_config' }, { status: 503 });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > EMAIL_SEND_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { payload, status } = await sendOfferEmail(
    { supabase, userId: auth.ctx.userId, businessId, role: auth.ctx.role },
    body,
    { apiKey, from, replyToEnv: process.env.EMAIL_REPLY_TO },
    { recordOutboundMessage },
  );
  return NextResponse.json(payload, { status });
}
