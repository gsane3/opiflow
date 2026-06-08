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

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  buildStoragePath,
  ensureValidUploadFile,
  UPLOAD_BUCKET,
  UPLOAD_TOKEN_EXPIRY_HOURS,
  generateRawUploadToken,
  hashUploadToken,
} from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface ManualTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
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

    const filename = str(raw.filename);
    const mimeType = str(raw.mimeType);
    const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : null;
    const reuseTokenId = str(raw.uploadTokenId);

    if (!filename || !mimeType || sizeBytes === null) {
      return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });
    }

    const validation = ensureValidUploadFile({ filename, mimeType, sizeBytes });
    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 422 });
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
    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Resolve the manual upload token row (reuse across a batch, or create one).
    // -------------------------------------------------------------------------
    let token: ManualTokenRow;

    if (reuseTokenId) {
      const { data: existing, error: existingError } = await serviceClient
        .from('customer_upload_tokens')
        .select('id, business_id, customer_id')
        .eq('id', reuseTokenId)
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .maybeSingle();

      if (existingError) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ ok: false, error: 'upload_token_not_found' }, { status: 404 });
      }
      token = existing as unknown as ManualTokenRow;
    } else {
      // Create a manual token row to satisfy the session FK. We mirror
      // createCustomerUploadToken but force sent_channel='manual'. The raw
      // token is never returned (business-side uploads use this authenticated
      // route, not the public /upload/[token] page).
      const rawToken = generateRawUploadToken();
      const tokenHash = hashUploadToken(rawToken);
      const expiresAt = new Date(
        Date.now() + UPLOAD_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
      ).toISOString();

      const { data: created, error: createError } = await serviceClient
        .from('customer_upload_tokens')
        .insert({
          business_id: businessId,
          customer_id: customerId,
          token_hash: tokenHash,
          status: 'opened',
          sent_channel: 'manual',
          sent_to_phone: null,
          expires_at: expiresAt,
          updated_at: now,
        })
        .select('id, business_id, customer_id')
        .single();

      if (createError || !created) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      token = created as unknown as ManualTokenRow;
    }

    // -------------------------------------------------------------------------
    // Build storage path + signed upload URL (identical to the public flow).
    // -------------------------------------------------------------------------
    const storagePath = buildStoragePath({
      businessId: token.business_id,
      customerId: token.customer_id,
      uploadTokenId: token.id,
      filename,
    });

    const { data, error } = await serviceClient.storage
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
      uploadTokenId: token.id,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
