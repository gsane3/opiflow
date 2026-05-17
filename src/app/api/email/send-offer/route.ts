import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 32_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// MVP-only in-memory rate limiter. Not persistent across instances or restarts.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const ipMap = new Map<string, { count: number; resetAt: number }>();

function getIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count += 1;
  return false;
}

export async function POST(req: NextRequest) {
  if (isRateLimited(getIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, error: 'missing_email_config' }, { status: 503 });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const { to, subject, text, html } = body as Record<string, unknown>;

  if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
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

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'yorgos-ai-mvp/0.1',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { id?: string; message?: string };

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data.message ?? 'provider_error' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch {
    return NextResponse.json({ ok: false, error: 'network_error' }, { status: 502 });
  }
}
