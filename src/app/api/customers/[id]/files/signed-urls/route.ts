// POST /api/customers/[id]/files/signed-urls
// Batch variant of files/signed-url: returns signed view URLs for EVERY file of
// the requested upload sessions in ONE round trip (one storage call via
// createSignedUrls). The per-file endpoint cost the gallery 1 request per
// thumbnail — 20 photos = 20 sequential round-trips on mobile data.
// The client never provides storage paths; they are read server-side from
// customer_upload_sessions.files.
//
// ADOPTED to the modular pattern (src/server/modules/customer-files): thin
// adapter. The 415 content-type guard + auth stay here; the JSON parse maps a
// malformed body to invalid_body (400); the flatten + batch signing live in the
// service. Byte-identical codes (unsupported_content_type 415, invalid_body 400,
// storage_unavailable 503, server_error 500) and the { ok:true, files } shape
// (including the empty-files short-circuit).

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import { getSignedUrls } from '@/server/modules/customer-files/customer-files.service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_body', 400);
    }
    const { id: customerId } = await params;
    const result = await getSignedUrls(ctx, body, customerId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
