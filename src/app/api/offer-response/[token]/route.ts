// Public offer-response API. No authenticated Bearer is required.
// The raw public token is the sole credential -- it is hashed before any DB lookup.
// Service-role Supabase client is used for all DB operations.
// Raw DB error messages are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidOfferResponseToken,
} from '@/lib/server/offer-response-tokens';
import type { OfferResponseTokenRow } from '@/lib/server/offer-response-tokens';
import { applyOfferResponse } from '@/lib/server/offer-accept';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import {
  loadOfferResponse,
  respondToOffer,
} from '@/server/modules/public-offer-response/public-offer-response.service';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

// ---------------------------------------------------------------------------
// GET /api/offer-response/[token]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;

  // Validate token (hashes internally, queries DB with service_role)
  let tokenRow: OfferResponseTokenRow | null;
  try {
    tokenRow = await findValidOfferResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'offer_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  const result = await loadOfferResponse(
    { supabase, businessId: tokenRow.business_id },
    tokenRow
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.body);
}

// ---------------------------------------------------------------------------
// POST /api/offer-response/[token]
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  // Content-type guard
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const { token: rawToken } = await params;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  // Accept `response` or `action` key
  const responseRaw = raw.response ?? raw.action;
  if (responseRaw !== 'accepted' && responseRaw !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'invalid_response' }, { status: 400 });
  }
  const response = responseRaw as 'accepted' | 'rejected';

  // Extract and sanitize comment
  let comment: string | null = null;
  if (typeof raw.comment === 'string') {
    const trimmed = raw.comment.trim();
    if (trimmed.length > 0) {
      comment = trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
    }
  }

  // Validate token
  let tokenRow: OfferResponseTokenRow | null;
  try {
    tokenRow = await findValidOfferResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'offer_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'offer_response_load_failed' },
      { status: 500 }
    );
  }

  const result = await respondToOffer(
    { supabase, businessId: tokenRow.business_id },
    tokenRow,
    { response, comment },
    { applyOfferResponse }
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.body);
}
