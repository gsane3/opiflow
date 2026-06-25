// POST /api/f/[token]/payment — customer self-reports a bank deposit from the
// public portal («Δήλωσα την κατάθεση»). Folder token in the URL is the sole
// credential (hashed, fail-closed). The payment request is updated TRIPLE-scoped
// to the token's business_id + work_folder_id, and ONLY from 'pending' → 'declared'
// (atomic) — a foreign/guessed/already-settled id matches 0 rows → generic 409,
// no oracle. 'declared' is NOT authoritative; the owner confirms separately.
// Service-role only; raw DB errors never leak. Requires migration 048.
//
// Adopted to the public-folder module: the route keeps the token VERIFY +
// content-type/JSON/paymentRequestId validation verbatim; the atomic declare +
// owner push move to declareFolderPayment (service-role, business+folder scoped).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { declareFolderPayment } from '@/server/modules/public-folder/public-folder.service';

export const runtime = 'nodejs';

const publicLimiter = makePublicLimiter(10, 60_000);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const { token: rawToken } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.paymentRequestId !== 'string' || raw.paymentRequestId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'payment_required' }, { status: 400 });
  }
  const paymentRequestId = raw.paymentRequestId;

  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'payment_declare_failed' }, { status: 500 });
  }
  if (!tokenRow) {
    return NextResponse.json({ ok: false, error: 'folder_link_invalid_or_expired' }, { status: 404 });
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'payment_declare_failed' }, { status: 500 });
  }

  // Atomic: mark 'pending' → 'declared', scoped to the token's folder + business,
  // then best-effort notify the owner to confirm. A wrong/foreign/already-declared
  // id matches no row → generic 409 (no oracle).
  const failure = await declareFolderPayment(
    {
      supabase,
      businessId: tokenRow.business_id,
      workFolderId: tokenRow.work_folder_id,
      tokenId: tokenRow.id,
      sentChannel: tokenRow.sent_channel,
    },
    paymentRequestId,
    { notifyOwner: sendPushToBusinessOwner },
  );
  if (failure) {
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ ok: true });
}
