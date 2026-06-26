import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import type { CmdReviewResult } from '@/lib/ai/cmd-schema';
import { fetchCatalogPriceRows } from '@/server/modules/ai/ai.repo';
import { runCmd } from '@/server/modules/ai/ai.service';

export const runtime = 'nodejs';

// For a create_offer with line items that have NO price (unitPrice 0), best-effort
// fill the price from the service catalog by matching the description against the
// catalog item name (normalised: lowercase, no spaces/dashes, Greek × → x). Never
// fabricates a price — items with no catalog match stay at 0 (the UI then requires
// the user to enter a price before sending). Fully graceful: any failure → unchanged.
async function enrichOfferPricesFromCatalog(result: CmdReviewResult, req: NextRequest): Promise<CmdReviewResult> {
  if (result.intent !== 'create_offer') return result;
  const items = result.params.offerItems;
  if (!items || !items.some((i) => i.unitPrice === 0)) return result;
  try {
    const auth = await authenticateBusinessRequest(req);
    if ('error' in auth) return result;
    const { supabase, businessId } = auth.ctx;
    const rows = await fetchCatalogPriceRows(supabase, businessId);
    if (rows.length === 0) return result;
    const norm = (s: string) => s.toLowerCase().replace(/×/g, 'x').replace(/[\s\-_.]/g, '');
    const byName = new Map<string, number>();
    for (const r of rows) {
      if (r.name && typeof r.unit_price === 'number' && r.unit_price > 0) byName.set(norm(r.name), r.unit_price);
    }
    const enriched = items.map((it) => {
      if (it.unitPrice > 0) return it;
      const price = byName.get(norm(it.description));
      return typeof price === 'number' && price > 0 ? { ...it, unitPrice: price } : it;
    });
    return { ...result, params: { ...result.params, offerItems: enriched } };
  } catch {
    return result;
  }
}

const CMD_MAX_BODY_BYTES = 16_000;
const CMD_MAX_INPUT_CHARS = 500;

const CMD_RATE_LIMIT_MAX = 10;
const CMD_RATE_LIMIT_WINDOW_MS = 60_000;
const cmdRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = cmdRateLimitStore.get(key);
  if (!entry || now >= entry.resetAt) {
    cmdRateLimitStore.set(key, { count: 1, resetAt: now + CMD_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= CMD_RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

function getBearerToken(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

// Require a valid signed-in user so the server-side ANTHROPIC_API_KEY cannot be
// burned (cost/DoS) by anonymous callers. Returns the user id on success so the
// rate limiter can key on the authenticated identity (a spoofable client IP
// would let one user rotate headers to exceed the cap).
async function requireUser(req: NextRequest): Promise<{ userId: string } | { error: NextResponse }> {
  const token = getBearerToken(req);
  if (!token) return { error: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }) };
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 }) };
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
    return { userId: user.id };
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
  }
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const contentLengthRaw = req.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = parseInt(contentLengthRaw, 10);
    if (!isNaN(contentLength) && contentLength > CMD_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
  }

  const auth = await requireUser(req);
  if ('error' in auth) return auth.error;

  // Rate-limit per authenticated user (not per spoofable client IP).
  if (isRateLimited(auth.userId)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'no_api_key' }, { status: 503 });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > CMD_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const { inputText, businessType, businessName } = body as Record<string, unknown>;

  const text = typeof inputText === 'string' ? inputText.trim() : '';
  if (!text) {
    return NextResponse.json({ ok: false, error: 'missing_input' }, { status: 400 });
  }
  if (text.length > CMD_MAX_INPUT_CHARS) {
    return NextResponse.json({ ok: false, error: 'input_too_long' }, { status: 400 });
  }

  const outcome = await runCmd(apiKey, {
    inputText: text,
    businessType: typeof businessType === 'string' ? businessType : undefined,
    businessName: typeof businessName === 'string' ? businessName : undefined,
  });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.code }, { status: outcome.status });
  }

  const result = await enrichOfferPricesFromCatalog(outcome.result, req);
  return NextResponse.json({ ok: true, result });
}
