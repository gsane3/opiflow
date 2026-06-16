// Public folder-portal offer response (Portal v2). No authenticated Bearer — the
// raw folder token in the URL is the sole credential (hashed before any lookup;
// fail-closed on invalid/expired/revoked). The offer is fetched TRIPLE-scoped to
// the token's business_id AND work_folder_id, so a customer holding one folder's
// link can ONLY act on offers in THAT folder (cross-folder/business = 404, no
// oracle). The accept/reject side effects run through the SAME shared lib as the
// offer-response token route (applyOfferResponse), with tokenId omitted (no
// offer-response token here) and work_folder_id stamped so it shows on the
// folder timeline. Service-role only; raw DB errors never leak.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { applyOfferResponse, type OfferForResponse } from '@/lib/server/offer-accept';

export const runtime = 'nodejs';

// Writes a row — tighter limit, matching the folder-question route.
const publicLimiter = makePublicLimiter(10, 60_000);

const OFFER_COLUMNS = 'id, customer_id, offer_number, status, valid_until, notes, total';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; offerId: string }> },
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const { token: rawToken, offerId } = await params;

  // Parse + validate body
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
  const responseRaw = raw.response ?? raw.action;
  if (responseRaw !== 'accepted' && responseRaw !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'invalid_response' }, { status: 400 });
  }
  const response = responseRaw as 'accepted' | 'rejected';

  let comment: string | null = null;
  if (typeof raw.comment === 'string') {
    const trimmed = raw.comment.trim();
    if (trimmed.length > 0) comment = trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
  }

  // Validate the folder token (fail closed on invalid/expired/revoked).
  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_response_failed' }, { status: 500 });
  }
  if (!tokenRow) {
    return NextResponse.json({ ok: false, error: 'folder_link_invalid_or_expired' }, { status: 404 });
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_response_failed' }, { status: 500 });
  }

  // IDOR-critical: fetch the offer scoped to BOTH the token's business_id AND its
  // work_folder_id. A wrong/foreign offerId simply yields no row → 404 (no oracle).
  let offer: OfferForResponse;
  try {
    const { data, error } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', offerId)
      .eq('business_id', tokenRow.business_id)
      .eq('work_folder_id', tokenRow.work_folder_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: 'offer_response_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }
    offer = data as unknown as OfferForResponse;
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_response_failed' }, { status: 500 });
  }

  // Same shared path as the token route — tokenId omitted (no offer-response
  // token); stamp work_folder_id so the response lands on the folder timeline.
  const result = await applyOfferResponse({
    supabase,
    businessId: tokenRow.business_id,
    offer,
    response,
    comment,
    sentChannel: tokenRow.sent_channel,
    tokenId: undefined,
    workFolderId: tokenRow.work_folder_id,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({
    ok: true,
    response,
    offer: { offerNumber: result.offerNumber, status: result.status, total: result.total },
  });
}
