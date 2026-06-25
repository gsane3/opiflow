// POST /api/offers/[id]/response-link
//
// ADOPTED to the modular pattern (src/server/modules/offers): thin adapter. Creates a
// fresh secure offer-response token (revoking any active one first) — the ownership
// check, the service-role revoke, and the token mint live in the service. Returns only
// the safe fields ({ ok, responseUrl, tokenId, expiresAt }); never the raw token/hash.
// Byte-identical: offer_not_found (404), response_link_failed (500).

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { createOfferResponseLink } from '@/server/modules/offers/offers.service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id: offerId } = await params;
    const result = await createOfferResponseLink(ctx, offerId);
    return ok({ responseUrl: result.responseUrl, tokenId: result.tokenId, expiresAt: result.expiresAt });
  } catch (err) {
    return handleApiError(err);
  }
}
