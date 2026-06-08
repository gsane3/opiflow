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

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  ensureValidUploadFile,
  getUploadKind,
  markUploadTokenCompleted,
  MAX_FILES_PER_SESSION,
} from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileRecord {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: 'photo' | 'video' | 'other';
}

interface InsertedSessionRow {
  id: string;
  file_count: number;
  files: FileRecord[];
  customer_comment: string | null;
  uploaded_at: string;
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
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const uploadTokenId = str(raw.uploadTokenId);
    if (!uploadTokenId) {
      return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });
    }

    if (
      !Array.isArray(raw.files) ||
      raw.files.length === 0 ||
      raw.files.length > MAX_FILES_PER_SESSION
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_files' }, { status: 400 });
    }

    const { id: customerId } = await params;

    // Verify the customer belongs to this business (auth-scoped client).
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (customerError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!customerData) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const serviceClient = createServiceSupabaseClient();

    // Verify the upload token belongs to this customer + business, and derive
    // the expected storage-path prefix from it (mirrors the public flow's
    // tamper check so a caller cannot record paths under another tenant).
    const { data: tokenData, error: tokenError } = await serviceClient
      .from('customer_upload_tokens')
      .select('id, business_id, customer_id')
      .eq('id', uploadTokenId)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (tokenError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!tokenData) {
      return NextResponse.json({ ok: false, error: 'upload_token_not_found' }, { status: 404 });
    }

    const expectedPrefix = `${businessId}/${customerId}/${uploadTokenId}/`;

    const files: FileRecord[] = [];

    for (const f of raw.files as unknown[]) {
      if (typeof f !== 'object' || f === null || Array.isArray(f)) {
        return NextResponse.json({ ok: false, error: 'invalid_file_entry' }, { status: 400 });
      }
      const fe = f as Record<string, unknown>;

      const path = str(fe.path);
      const name = str(fe.name);
      const mimeType = str(fe.mimeType);
      const sizeBytes = typeof fe.sizeBytes === 'number' ? fe.sizeBytes : null;

      if (!path || !name || !mimeType || sizeBytes === null) {
        return NextResponse.json({ ok: false, error: 'invalid_file_entry' }, { status: 400 });
      }

      if (!path.startsWith(expectedPrefix)) {
        return NextResponse.json({ ok: false, error: 'invalid_upload_path' }, { status: 403 });
      }

      const validation = ensureValidUploadFile({ filename: name, mimeType, sizeBytes });
      if (!validation.valid) {
        return NextResponse.json({ ok: false, error: validation.error }, { status: 422 });
      }

      files.push({
        path,
        name,
        sizeBytes,
        mimeType,
        kind: getUploadKind(mimeType),
      });
    }

    const comment = str(raw.comment) ?? null;
    const now = new Date().toISOString();

    // Insert ONE session row — columns identical to the public complete route,
    // and selecting back exactly the fields the detail page reads.
    const { data: inserted, error: insertError } = await serviceClient
      .from('customer_upload_sessions')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        upload_token_id: uploadTokenId,
        file_count: files.length,
        files,
        customer_comment: comment,
        uploaded_at: now,
        updated_at: now,
      })
      .select('id, file_count, files, customer_comment, uploaded_at')
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    // Mark the manual token completed (non-fatal: session is already recorded).
    try {
      await markUploadTokenCompleted(uploadTokenId);
    } catch {
      // intentionally swallowed
    }

    return NextResponse.json({
      ok: true,
      session: inserted as unknown as InsertedSessionRow,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
