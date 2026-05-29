// POST /api/upload/[token]/complete
// Records uploaded file metadata in customer_upload_sessions and marks the token completed.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidUploadToken,
  markUploadTokenCompleted,
  ensureValidUploadFile,
  getUploadKind,
  MAX_FILES_PER_SESSION,
} from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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

    if (
      !Array.isArray(raw.files) ||
      raw.files.length === 0 ||
      raw.files.length > MAX_FILES_PER_SESSION
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_files' }, { status: 400 });
    }

    const expectedPrefix = `${tokenRow.business_id}/${tokenRow.customer_id}/${tokenRow.id}/`;

    interface FileRecord {
      path: string;
      name: string;
      sizeBytes: number;
      mimeType: string;
      kind: 'photo' | 'video' | 'other';
    }

    const files: FileRecord[] = [];

    for (const f of raw.files as unknown[]) {
      if (typeof f !== 'object' || f === null || Array.isArray(f)) {
        return NextResponse.json({ ok: false, error: 'invalid_file_entry' }, { status: 400 });
      }
      const fe = f as Record<string, unknown>;

      const uploadPath = str(fe.uploadPath);
      const name = str(fe.name);
      const mimeType = str(fe.mimeType);
      const sizeBytes = typeof fe.sizeBytes === 'number' ? fe.sizeBytes : null;

      if (!uploadPath || !name || !mimeType || sizeBytes === null) {
        return NextResponse.json({ ok: false, error: 'invalid_file_entry' }, { status: 400 });
      }

      if (!uploadPath.startsWith(expectedPrefix)) {
        return NextResponse.json({ ok: false, error: 'invalid_upload_path' }, { status: 403 });
      }

      const validation = ensureValidUploadFile({ filename: name, mimeType, sizeBytes });
      if (!validation.valid) {
        return NextResponse.json({ ok: false, error: validation.error }, { status: 422 });
      }

      files.push({
        path: uploadPath,
        name,
        sizeBytes,
        mimeType,
        kind: getUploadKind(mimeType),
      });
    }

    const customerComment = str(raw.customerComment) ?? null;
    const supabase = createServiceSupabaseClient();
    const now = new Date().toISOString();

    const { error: insertError } = await supabase.from('customer_upload_sessions').insert({
      business_id: tokenRow.business_id,
      customer_id: tokenRow.customer_id,
      upload_token_id: tokenRow.id,
      file_count: files.length,
      files,
      customer_comment: customerComment,
      uploaded_at: now,
      updated_at: now,
    });

    if (insertError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    try {
      await markUploadTokenCompleted(tokenRow.id);
    } catch {
      // non-fatal: session is already recorded
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
