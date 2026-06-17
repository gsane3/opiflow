// Public folder upload-link API. The customer, from the public /f/[token] portal
// «Φωτογραφίες» tile, asks for a place to upload photos/videos of the job. The raw
// folder token in the URL is the sole credential; it is hashed before any DB lookup
// (findValidFolderToken) and an invalid/expired/revoked token fails closed.
//
// We mint a fresh customer upload token scoped to THIS folder's customer/business
// (derived server-side from the folder, never trusted from the client) and return
// the `/upload/<token>` URL. The whole existing upload stack (signed-url → storage →
// complete → timeline recording) then handles the actual upload — no duplication.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { createCustomerUploadToken } from '@/lib/server/upload-tokens';

export const runtime = 'nodejs';

// Mints a DB row → tighter limit than the read flows.
const publicLimiter = makePublicLimiter(5, 60_000);

interface FolderRow {
  customer_id: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const { token: rawToken } = await params;

  // Validate token (hashes internally; fail closed on invalid/expired/revoked).
  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'upload_link_failed' }, { status: 500 });
  }
  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'folder_link_invalid_or_expired' },
      { status: 404 },
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'upload_link_failed' }, { status: 500 });
  }

  // Resolve the folder's customer_id, scoped to the token's business. The token
  // carries no customer_id; it is derived here so the upload can only ever be
  // filed under this token's folder/customer/business.
  let folder: FolderRow;
  try {
    const { data, error } = await supabase
      .from('work_folders')
      .select('customer_id')
      .eq('id', tokenRow.work_folder_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: 'upload_link_failed' }, { status: 500 });
    }
    if (!data || !(data as FolderRow).customer_id) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    folder = data as unknown as FolderRow;
  } catch {
    return NextResponse.json({ ok: false, error: 'upload_link_failed' }, { status: 500 });
  }

  // Mint a fresh upload token for this folder (sent_channel 'manual' = self-served
  // from the portal). Files land filed under the same work folder.
  try {
    const { uploadUrl } = await createCustomerUploadToken({
      businessId: tokenRow.business_id,
      customerId: folder.customer_id,
      workFolderId: tokenRow.work_folder_id,
      sentChannel: 'manual',
    });
    return NextResponse.json({ ok: true, url: uploadUrl });
  } catch {
    return NextResponse.json({ ok: false, error: 'upload_link_failed' }, { status: 500 });
  }
}
