// POST /api/offers/[id]/response-link
// Creates a fresh secure offer response token for a backend offer.
// Requires authenticated Bearer token.
// Revokes any existing pending or sent tokens for the same offer before
// creating a new one, so only one active link exists at a time.
// Returns: { ok: true, responseUrl, tokenId, expiresAt }
// Does NOT return the raw token or token hash.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createOfferResponseToken,
} from '@/lib/server/offer-response-tokens';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /api/offers/[id]/response-link
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: offerId } = await params;

    // Verify the offer exists and belongs to this business.
    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .select('id')
      .eq('id', offerId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (offerError) {
      return NextResponse.json({ ok: false, error: 'response_link_failed' }, { status: 500 });
    }
    if (!offerData) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }

    // Revoke any existing pending or sent tokens for this offer.
    // Service-role client is used because offer_response_tokens may be
    // protected by RLS policies that only allow insert/read by service role.
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    const { error: revokeError } = await serviceClient
      .from('offer_response_tokens')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('business_id', businessId)
      .eq('offer_id', offerId)
      .in('status', ['pending', 'sent'])
      .is('revoked_at', null);

    if (revokeError) {
      return NextResponse.json({ ok: false, error: 'response_link_failed' }, { status: 500 });
    }

    // Create a fresh token. sentChannel is omitted so status starts as 'pending'.
    // The raw token is discarded here; only the safe fields are returned.
    const result = await createOfferResponseToken({
      businessId,
      offerId,
    });

    return NextResponse.json({
      ok: true,
      responseUrl: result.responseUrl,
      tokenId: result.row.id,
      expiresAt: result.row.expires_at,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'response_link_failed' }, { status: 500 });
  }
}
