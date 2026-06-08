import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { recordOutboundMessage } from '@/lib/server/record-message';

export const runtime = 'nodejs';

const EMAIL_SEND_MAX_BODY_BYTES = 32_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_PROVIDER_TIMEOUT_MS = 15_000;

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

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const { to, subject, text, html, offerId } = body as Record<string, unknown>;

  if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }

  // Constrain the recipient to one of the caller's own customers, so the
  // company's verified sender domain cannot be abused as an open relay.
  const recipientEmail = to.trim();
  const likePattern = recipientEmail.replace(/([\\%_])/g, '\\$1');
  let recipientCustomerId: string | null = null;
  try {
    const { data: recipientMatch } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .ilike('email', likePattern)
      .limit(1)
      .maybeSingle();
    if (!recipientMatch) {
      return NextResponse.json({ ok: false, error: 'recipient_not_allowed' }, { status: 403 });
    }
    recipientCustomerId = (recipientMatch as { id?: string } | null)?.id ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: 'recipient_check_failed' }, { status: 500 });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return NextResponse.json({ ok: false, error: 'missing_subject' }, { status: 400 });
  }
  if (
    (!text || typeof text !== 'string' || !text.trim()) &&
    (!html || typeof html !== 'string' || !html.trim())
  ) {
    return NextResponse.json({ ok: false, error: 'missing_body' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    from,
    to: [to.trim()],
    subject: subject.trim(),
  };
  if (typeof text === 'string' && text.trim()) payload.text = text.trim();
  if (typeof html === 'string' && html.trim()) payload.html = html.trim();

  const replyTo = process.env.EMAIL_REPLY_TO;
  if (replyTo) payload.reply_to = replyTo;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'opiflow-mvp/0.1',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { id?: string; message?: string };

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'provider_error' }, { status: 502 });
    }

    // Email sent successfully -> advance the OFFER's own status so it no longer
    // reads as "Πρόχειρη" after a real send (label "Στάλθηκε"). Mirrors the Viber
    // notify route. Best-effort & non-fatal: the email was already sent, so a
    // status-update failure must not change the email response. Only acts when an
    // offerId was provided, and never regresses an offer that already reached a
    // final state (accepted/rejected/expired) or was already sent.
    if (typeof offerId === 'string' && offerId.trim()) {
      try {
        const { data: offerRow } = await supabase
          .from('offers')
          .select('id, status')
          .eq('id', offerId.trim())
          .eq('business_id', businessId)
          .maybeSingle();
        if (
          offerRow &&
          (offerRow.status === 'draft' || offerRow.status === 'ready_to_send')
        ) {
          await supabase
            .from('offers')
            .update({ status: 'sent_manually', updated_at: new Date().toISOString() })
            .eq('id', offerRow.id)
            .eq('business_id', businessId);
        }
      } catch {
        // intentionally swallowed: the email was already sent
      }
    }

    // Log to the customer timeline (#57). Best-effort; non-fatal.
    if (recipientCustomerId) {
      await recordOutboundMessage({
        businessId,
        customerId: recipientCustomerId,
        channel: 'email',
        summary: 'Αποστολή προσφοράς',
      });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ ok: false, error: 'email_timeout' }, { status: 504 });
    }
    return NextResponse.json({ ok: false, error: 'network_error' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
