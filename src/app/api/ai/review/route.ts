import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { BusinessType } from '@/lib/types';
import { runReview } from '@/server/modules/ai/ai.service';

export const runtime = 'nodejs';

const AI_REVIEW_MAX_BODY_BYTES = 32_000;

// MVP-only in-memory rate limiter. Resets on cold start; not shared across
// multiple serverless instances. Sufficient for protecting the API key in MVP.
const AI_REVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_REVIEW_RATE_LIMIT_MAX = 10;
const aiReviewRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = aiReviewRateLimitStore.get(ip);
  if (!entry || now >= entry.resetAt) {
    aiReviewRateLimitStore.set(ip, { count: 1, resetAt: now + AI_REVIEW_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= AI_REVIEW_RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

// Require a valid signed-in user so the server-side ANTHROPIC_API_KEY cannot be
// burned (cost/DoS) by anonymous callers.
async function requireUser(request: NextRequest): Promise<NextResponse | null> {
  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ error: 'missing_supabase_config' }, { status: 503 });
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return NextResponse.json({ error: 'invalid_auth' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'invalid_auth' }, { status: 401 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'unsupported_content_type' }, { status: 415 });
  }

  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = parseInt(contentLengthRaw, 10);
    if (!isNaN(contentLength) && contentLength > AI_REVIEW_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
  }

  const authError = await requireUser(request);
  if (authError) return authError;

  // API key is server-only — never sent to client
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key' }, { status: 503 });
  }

  let body: {
    inputText?: string;
    businessType?: BusinessType;
    businessName?: string;
    defaultVatRate?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const inputText = (body.inputText ?? '').trim();
  if (!inputText || inputText.length > 2000) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const outcome = await runReview(
    {
      inputText,
      businessType: body.businessType,
      businessName: body.businessName,
      defaultVatRate: body.defaultVatRate,
    },
    apiKey,
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.code }, { status: outcome.status });
  }

  return NextResponse.json({ result: outcome.result });
}
