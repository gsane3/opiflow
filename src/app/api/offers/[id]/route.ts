// Offer get-by-id, patch, and delete endpoints (GET/PATCH/DELETE /api/offers/[id]).
//
// ADOPTED to the modular pattern (src/server/modules/offers): thin adapter. The
// fetch+items assembly, the PATCH whitelist + items-replacement/totals recompute
// (client subtotal/vat ignored), and the dependent-cleanup delete (response tokens
// via the service client, then detach tasks) live in the service. Byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getOffer, updateOffer, deleteOffer } from '@/server/modules/offers/offers.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id } = await params;
    const offer = await getOffer(ctx, id);
    return ok({ offer });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const offer = await updateOffer(ctx, id, body as Record<string, unknown>);
    return ok({ offer });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id } = await params;
    await deleteOffer(ctx, id);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
