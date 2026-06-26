// POST /api/customers/[id]/files/signed-url
// Returns a 300-second signed view URL for one uploaded file.
// The file path is read server-side from customer_upload_sessions.files[fileIndex].
// The client never provides a storage path.
//
// ADOPTED to the modular pattern (src/server/modules/customer-files): thin
// adapter. The 415 content-type guard + auth stay here; the JSON parse maps a
// malformed body to invalid_body (400); the lookup + signing live in the service.
// Byte-identical codes (unsupported_content_type 415, invalid_body 400,
// invalid_file_index 400, session_not_found 404, storage_unavailable 503,
// server_error 500) and the { ok:true, signedUrl, name, mimeType, kind } shape.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import { getSignedUrl } from '@/server/modules/customer-files/customer-files.service';

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
    const result = await getSignedUrl(ctx, body, customerId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
