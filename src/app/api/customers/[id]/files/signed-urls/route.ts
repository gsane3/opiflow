// POST /api/customers/[id]/files/signed-urls
// Batch variant of files/signed-url: returns signed view URLs for EVERY file of
// the requested upload sessions in ONE round trip (one storage call via
// createSignedUrls). The per-file endpoint cost the gallery 1 request per
// thumbnail — 20 photos = 20 sequential round-trips on mobile data.
// The client never provides storage paths; they are read server-side from
// customer_upload_sessions.files.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { UPLOAD_BUCKET } from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

const MAX_SESSIONS = 20;
const MAX_FILES = 200;
const URL_TTL_SECONDS = 600;

interface SessionFileEntry {
  path: string;
  name: string;
  mimeType: string;
  kind: string;
}

function isFileEntry(entry: unknown): entry is SessionFileEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as Record<string, unknown>).path === 'string' &&
    typeof (entry as Record<string, unknown>).name === 'string' &&
    typeof (entry as Record<string, unknown>).mimeType === 'string' &&
    typeof (entry as Record<string, unknown>).kind === 'string'
  );
}

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
    const rawIds = (body as Record<string, unknown> | null)?.sessionIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_SESSIONS) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const sessionIds = rawIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (sessionIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const { id: customerId } = await params;

    const { data: sessionRows, error: sessionError } = await supabase
      .from('customer_upload_sessions')
      .select('id, files')
      .in('id', sessionIds)
      .eq('customer_id', customerId)
      .eq('business_id', businessId);

    if (sessionError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    // Collect every valid file entry (session order preserved) up to MAX_FILES.
    const flat: Array<{ sessionId: string; index: number; entry: SessionFileEntry }> = [];
    for (const row of (sessionRows ?? []) as Array<{ id: string; files: unknown }>) {
      if (!Array.isArray(row.files)) continue;
      row.files.forEach((entry, index) => {
        if (flat.length < MAX_FILES && isFileEntry(entry)) {
          flat.push({ sessionId: row.id, index, entry });
        }
      });
    }

    if (flat.length === 0) {
      return NextResponse.json({ ok: true, files: [] });
    }

    const { data: signed, error: storageError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .createSignedUrls(flat.map((f) => f.entry.path), URL_TTL_SECONDS);

    if (storageError || !signed) {
      return NextResponse.json({ ok: false, error: 'storage_unavailable' }, { status: 503 });
    }

    const files = flat.map((f, i) => ({
      sessionId: f.sessionId,
      fileIndex: f.index,
      signedUrl: signed[i]?.signedUrl ?? null,
      name: f.entry.name,
      mimeType: f.entry.mimeType,
      kind: f.entry.kind,
    }));

    return NextResponse.json({ ok: true, files });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
