// POST /api/customers/[id]/files/upload-url
// AUTHENTICATED business-side upload: lets a logged-in technician upload files
// directly onto a customer's record. Mirrors the PUBLIC flow
// (src/app/api/upload/[token]/signed-url/route.ts) so the resulting files land
// in the SAME customer-uploads bucket, the SAME storage path format, and (via
// the sibling complete route) the SAME customer_upload_sessions table that the
// customer detail page Files list reads.
//
// Bytes never pass through Next.js: this returns a Supabase Storage signed
// upload URL; the client uploads directly to Storage.
//
// To satisfy the customer_upload_sessions.upload_token_id FK, a manual
// customer_upload_tokens row (sent_channel='manual') is created. To group many
// files of one batch under a single session/token, the client may pass back the
// returned { uploadTokenId } on subsequent calls to reuse it.
//
// ADOPTED to the modular pattern (src/server/modules/customer-files): thin
// adapter. The 415 content-type guard + auth stay here; the JSON parse maps a
// malformed body to invalid_body (400); the token resolution + signed-upload-URL
// minting live in the service. Byte-identical codes (unsupported_content_type
// 415, invalid_body 400, missing_fields 400, invalid_mime_type/file_too_large/
// empty_file 422, customer_not_found 404, upload_token_not_found 404,
// storage_unavailable 503, server_error 500) and the
// { ok:true, uploadUrl, uploadPath, token, uploadTokenId } shape.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import { createUploadUrl } from '@/server/modules/customer-files/customer-files.service';

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
    const result = await createUploadUrl(ctx, body, customerId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
