// POST /api/upload/[token]/signed-url
// Generates a Supabase Storage signed upload URL for one file.
// The client uploads the file directly to Storage (bytes never pass through Next.js).

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidUploadToken,
  buildStoragePath,
  ensureValidUploadFile,
  UPLOAD_BUCKET,
} from '@/lib/server/upload-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP. Generous (one call per file, up to 10
// files per session) so a normal multi-photo upload is never blocked.
const publicLimiter = makePublicLimiter(60, 60_000, {
  message: 'Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.',
});

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const filename = str(raw.filename);
    const mimeType = str(raw.mimeType);
    const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null;

    if (!filename || !mimeType || sizeBytes === null) {
      return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });
    }

    const validation = ensureValidUploadFile({ filename, mimeType, sizeBytes });
    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 422 });
    }

    const storagePath = buildStoragePath({
      businessId: tokenRow.business_id,
      customerId: tokenRow.customer_id,
      uploadTokenId: tokenRow.id,
      filename,
    });

    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'storage_unavailable' }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      uploadUrl: data.signedUrl,
      uploadPath: data.path,
      token: data.token,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
