// GET /api/upload/[token]
// Verifies an upload token and returns public config for the upload form.
// Does not expose businessId, customerId, or storage paths.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidUploadToken,
  markUploadTokenOpened,
  hashUploadToken,
  ALLOWED_MIME_TYPES,
  MAX_FILES_PER_SESSION,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/server/upload-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';

export const runtime = 'nodejs';

const publicLimiter = makePublicLimiter(40, 60_000);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;
  try {
    const { token } = await params;
    const tokenRow = await findValidUploadToken(token);

    if (!tokenRow) {
      const tokenHash = hashUploadToken(token);
      const supabase = createServiceSupabaseClient();
      const { data } = await supabase
        .from('customer_upload_tokens')
        .select('status')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      const reason =
        data && (data as { status: string }).status === 'completed' ? 'completed' : 'invalid';

      return NextResponse.json({ ok: false, reason }, { status: 404 });
    }

    try {
      await markUploadTokenOpened(tokenRow.id);
    } catch {
      // intentionally swallowed
    }

    return NextResponse.json({
      ok: true,
      maxFiles: MAX_FILES_PER_SESSION,
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 });
  }
}
