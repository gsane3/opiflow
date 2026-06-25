// Public folder-question API (WF-3). No authenticated Bearer — the raw folder
// token in the URL is the sole credential; it is hashed before any DB lookup
// (findValidFolderToken) and an invalid/expired/revoked token fails closed.
//
// The customer, from the public /f/[token] page, sends ONE short question about
// their job. We log it as an INBOUND communications row filed under the folder
// (work_folder_id) so it appears in the customer timeline, then best-effort push
// the business owner. Service-role Supabase only; raw DB errors are never
// returned. Requires migration 046 (work_folders + communications.work_folder_id).
//
// Adopted to the public-folder module: the route keeps the token VERIFY +
// content-type/JSON/message validation verbatim; the post-token DB work moves to
// logFolderQuestion / listPublicFolderMessages (service-role, business+folder scoped).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { validateQuestionMessage } from '@/lib/server/folder-question';
import {
  logFolderQuestion,
  listPublicFolderMessages,
} from '@/server/modules/public-folder/public-folder.service';

export const runtime = 'nodejs';

// Public endpoint — tighter limit than the read flows since this writes a row.
const publicLimiter = makePublicLimiter(10, 60_000);
// The GET below is polled by the open chat sheet (~every 12s) so the customer
// sees the technician's replies live — more generous than the write limit.
const readLimiter = makePublicLimiter(40, 60_000);

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

  // Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const validation = validateQuestionMessage((body as Record<string, unknown>).message);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }
  const message = validation.message;

  // Validate token (hashes internally; fail closed on invalid/expired/revoked)
  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
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
    return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
  }

  // Resolve the folder, log the inbound question, and push the owner — all scoped
  // to the token's business → customer_id + title (the message can only ever be
  // filed under this token's folder/customer/business).
  const failure = await logFolderQuestion(
    {
      supabase,
      businessId: tokenRow.business_id,
      workFolderId: tokenRow.work_folder_id,
      tokenId: tokenRow.id,
      sentChannel: tokenRow.sent_channel,
    },
    message,
    { notifyOwner: sendPushToBusinessOwner },
  );
  if (failure) {
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ ok: true });
}

// Live chat read — the public /f/[token] page polls this while the chat sheet is
// open so the customer sees the technician's replies without reloading. Same
// fail-closed token rule as POST (hashed lookup; invalid/expired/revoked → 404).
// Returns ONLY the safe Q&A thread shape; `channel='call'` AI briefs are excluded
// by both the query and mapPublicMessages. Never returns raw DB errors.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await readLimiter(request);
  if (limited) return limited;

  const { token: rawToken } = await params;

  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_messages_failed' }, { status: 500 });
  }
  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'folder_link_invalid_or_expired' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_messages_failed' }, { status: 500 });
  }

  const result = await listPublicFolderMessages({
    supabase,
    businessId: tokenRow.business_id,
    workFolderId: tokenRow.work_folder_id,
    tokenId: tokenRow.id,
    sentChannel: tokenRow.sent_channel,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, messages: result.messages }, { headers: { 'Cache-Control': 'no-store' } });
}
