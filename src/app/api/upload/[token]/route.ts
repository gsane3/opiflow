// GET /api/upload/[token]
// Verifies an upload token and returns public config for the upload form.
// Does not expose businessId, customerId, or storage paths.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidUploadToken,
  markUploadTokenOpened,
} from '@/lib/server/upload-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import {
  publicUploadConfig,
  resolveNotFoundReason,
} from '@/server/modules/public-upload/public-upload.service';

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
      const supabase = createServiceSupabaseClient();
      const reason = await resolveNotFoundReason({ supabase }, token);

      return NextResponse.json({ ok: false, reason }, { status: 404 });
    }

    try {
      await markUploadTokenOpened(tokenRow.id);
    } catch {
      // intentionally swallowed
    }

    return NextResponse.json({
      ok: true,
      ...publicUploadConfig(),
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 });
  }
}
