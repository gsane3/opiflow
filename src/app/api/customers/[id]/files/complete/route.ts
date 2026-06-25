// POST /api/customers/[id]/files/complete
// AUTHENTICATED business-side counterpart to /api/upload/[token]/complete.
// After the technician has uploaded files via the signed URLs from
// /api/customers/[id]/files/upload-url, this records ONE
// customer_upload_sessions row so the files appear in the SAME Files list the
// customer detail page renders (it reads id, file_count, files,
// customer_comment, uploaded_at). The files JSONB element shape
// ({ path, name, sizeBytes, mimeType, kind }) matches the public flow exactly,
// so the read endpoint /api/customers/[id]/files/signed-url keeps working
// unchanged.
//
// ADOPTED to the modular pattern (src/server/modules/customer-files): thin
// adapter. The 415 content-type guard + auth stay here; the JSON parse maps a
// malformed body to invalid_body (400); the record/verify body lives in the
// service. Byte-identical codes (unsupported_content_type 415, invalid_body 400,
// missing_fields 400, invalid_files 400, customer_not_found 404,
// upload_token_not_found 404, invalid_file_entry 400, invalid_upload_path 403,
// invalid_mime_type/file_too_large/empty_file 422, storage server_error 500) and
// the { ok:true, session } shape.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import { completeUpload } from '@/server/modules/customer-files/customer-files.service';

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
    const result = await completeUpload(ctx, body, customerId);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
