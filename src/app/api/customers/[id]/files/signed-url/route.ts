// POST /api/customers/[id]/files/signed-url
// Returns a 300-second signed view URL for one uploaded file.
// The file path is read server-side from customer_upload_sessions.files[fileIndex].
// The client never provides a storage path.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { UPLOAD_BUCKET } from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers (mirrors upload-link/route.ts pattern)
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface SessionFileEntry {
  path: string;
  name: string;
  mimeType: string;
  kind: string;
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/files/signed-url
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
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

    const sessionId = str(raw.sessionId);
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const fileIndex = raw.fileIndex;
    if (
      typeof fileIndex !== 'number' ||
      !Number.isInteger(fileIndex) ||
      fileIndex < 0
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_file_index' }, { status: 400 });
    }

    const { id: customerId } = await params;

    const { data: sessionData, error: sessionError } = await supabase
      .from('customer_upload_sessions')
      .select('files')
      .eq('id', sessionId)
      .eq('customer_id', customerId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!sessionData) {
      return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 });
    }

    const files = (sessionData as unknown as { files: unknown }).files;
    if (!Array.isArray(files) || fileIndex >= files.length) {
      return NextResponse.json({ ok: false, error: 'invalid_file_index' }, { status: 400 });
    }

    const entry = files[fileIndex] as unknown;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).path !== 'string' ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).mimeType !== 'string' ||
      typeof (entry as Record<string, unknown>).kind !== 'string'
    ) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    const fileEntry = entry as SessionFileEntry;

    const { data: signedData, error: storageError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .createSignedUrl(fileEntry.path, 300);

    if (storageError || !signedData) {
      return NextResponse.json({ ok: false, error: 'storage_unavailable' }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      signedUrl: signedData.signedUrl,
      name: fileEntry.name,
      mimeType: fileEntry.mimeType,
      kind: fileEntry.kind,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
