// POST /api/f/[token]/payment — customer self-reports a bank deposit from the
// public portal («Δήλωσα την κατάθεση»). Folder token in the URL is the sole
// credential (hashed, fail-closed). The payment request is updated TRIPLE-scoped
// to the token's business_id + work_folder_id, and ONLY from 'pending' → 'declared'
// (atomic) — a foreign/guessed/already-settled id matches 0 rows → generic 409,
// no oracle. 'declared' is NOT authoritative; the owner confirms separately.
// Service-role only; raw DB errors never leak. Requires migration 048.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';

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

  // Atomic: mark 'pending' → 'declared', scoped to the token's folder + business.
  // A wrong/foreign/already-declared id matches no row → generic 409 (no oracle).
  const now = new Date().toISOString();
  let updated: { id: string; customer_id: string | null }[] | null;
  try {
    const { data, error } = await supabase
      .from('payment_requests')
      .update({ status: 'declared', declared_at: now, updated_at: now })
      .eq('id', paymentRequestId)
      .eq('business_id', tokenRow.business_id)
      .eq('work_folder_id', tokenRow.work_folder_id)
      .eq('status', 'pending')
      .select('id, customer_id');
    if (error) return NextResponse.json({ ok: false, error: 'payment_declare_failed' }, { status: 500 });
    updated = data as unknown as { id: string; customer_id: string | null }[];
  } catch {
    return NextResponse.json({ ok: false, error: 'payment_declare_failed' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: false, error: 'payment_not_actionable' }, { status: 409 });
  }

  // Notify the owner to confirm (best-effort, inert until FCM configured).
  await sendPushToBusinessOwner(tokenRow.business_id, {
    title: 'Ο πελάτης δήλωσε κατάθεση',
    body: 'Ένας πελάτης δήλωσε ότι έκανε την κατάθεση — επιβεβαίωσέ τη.',
    ...(updated[0].customer_id ? { url: `/customers/${updated[0].customer_id}` } : {}),
    data: { type: 'payment_declared', paymentRequestId },
  });

  return NextResponse.json({ ok: true });
}
