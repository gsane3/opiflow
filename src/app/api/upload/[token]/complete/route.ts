// POST /api/upload/[token]/complete
// Records uploaded file metadata in customer_upload_sessions and marks the token completed.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidUploadToken,
  markUploadTokenCompleted,
} from '@/lib/server/upload-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { AppError } from '@/server/core/errors';
import { recordUpload } from '@/server/modules/public-upload/public-upload.service';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP (one call per finished upload session).
const publicLimiter = makePublicLimiter(30, 60_000, {
  message: 'Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.',
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const { token } = await params;
    const tokenRow = await findValidUploadToken(token);
    if (!tokenRow) {
      return NextResponse.json({ ok: false, error: 'token_invalid' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const supabase = createServiceSupabaseClient();
    const result = await recordUpload({ supabase }, tokenRow, body, {
      markCompleted: markUploadTokenCompleted,
      sendPush: (businessId, payload) => sendPushToBusinessOwner(businessId, payload),
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
