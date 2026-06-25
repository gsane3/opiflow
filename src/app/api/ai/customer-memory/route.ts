// POST /api/ai/customer-memory
// Authenticated endpoint that suggests customer memory updates from recent CRM context.
// Requires Bearer token. Loads context server-side scoped to the authenticated business.
// Returns proposed field values only. Does not write to the database.
// Review-first: the user must approve by saving via PATCH /api/customers/[id].

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';
import { fetchBusinessById } from '@/server/modules/ai/ai.repo';
import { runCustomerMemory } from '@/server/modules/ai/ai.service';

export const runtime = 'nodejs';

const MEMORY_MAX_BODY_BYTES = 8_000;

const MEMORY_RATE_LIMIT_MAX = 5;
const MEMORY_RATE_LIMIT_WINDOW_MS = 60_000;
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = memoryRateLimitStore.get(ip);
  if (!entry || now >= entry.resetAt) {
    memoryRateLimitStore.set(ip, { count: 1, resetAt: now + MEMORY_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= MEMORY_RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function getBusinessContext(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string; name: string; type: string } | null> {
  // Membership-aware (not owner_id) so invited team members get their business.
  const resolved = await resolveBusinessContext(supabase, userId);
  if (!resolved) return null;
  const row = await fetchBusinessById(supabase, resolved.businessId);
  if (!row) return null;
  return { id: row.id, name: row.name ?? '', type: row.type ?? 'other' };
}

// ---------------------------------------------------------------------------
// POST /api/ai/customer-memory
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const cl = parseInt(contentLengthRaw, 10);
    if (!isNaN(cl) && cl > MEMORY_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'no_api_key' }, { status: 503 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }

  // Validate session
  let userId: string;
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
  }

  // Load business
  let business: { id: string; name: string; type: string };
  try {
    const biz = await getBusinessContext(supabase, userId);
    if (!biz) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }
    business = biz;
  } catch {
    return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const customerId = typeof raw.customerId === 'string' ? raw.customerId.trim() : '';
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'missing_customer_id' }, { status: 400 });
  }
  const triggerEvent =
    typeof raw.triggerEvent === 'string' ? raw.triggerEvent.trim() || null : null;

  const outcome = await runCustomerMemory(supabase, apiKey, business, { customerId, triggerEvent });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.code }, { status: outcome.status });
  }

  return NextResponse.json({ ok: true, suggestion: outcome.suggestion });
}
