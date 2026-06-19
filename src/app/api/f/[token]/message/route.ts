// Public folder-question API (WF-3). No authenticated Bearer — the raw folder
// token in the URL is the sole credential; it is hashed before any DB lookup
// (findValidFolderToken) and an invalid/expired/revoked token fails closed.
//
// The customer, from the public /f/[token] page, sends ONE short question about
// their job. We log it as an INBOUND communications row filed under the folder
// (work_folder_id) so it appears in the customer timeline, then best-effort push
// the business owner. Service-role Supabase only; raw DB errors are never
// returned. Requires migration 046 (work_folders + communications.work_folder_id).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import {
  validateQuestionMessage,
  buildFolderQuestionSummary,
  resolveFolderChannel,
  buildQuestionPreview,
} from '@/lib/server/folder-question';
import { mapPublicMessages, type MessageRowForPublic } from '@/lib/server/public-folder';

export const runtime = 'nodejs';

// Public endpoint — tighter limit than the read flows since this writes a row.
const publicLimiter = makePublicLimiter(10, 60_000);
// The GET below is polled by the open chat sheet (~every 12s) so the customer
// sees the technician's replies live — more generous than the write limit.
const readLimiter = makePublicLimiter(40, 60_000);

interface FolderRow {
  customer_id: string;
  title: string;
}

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

  // Resolve the folder, scoped to the token's business → customer_id + title.
  // The token carries no customer_id; it is derived here (business-scoped) so the
  // message can only ever be filed under this token's folder/customer/business.
  let folder: FolderRow;
  try {
    const { data, error } = await supabase
      .from('work_folders')
      .select('customer_id, title')
      .eq('id', tokenRow.work_folder_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    folder = data as unknown as FolderRow;
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
  }

  // Log the inbound question on the customer timeline, filed under the folder.
  const summary = buildFolderQuestionSummary(message);
  try {
    const { error } = await supabase.from('communications').insert({
      business_id: tokenRow.business_id,
      customer_id: folder.customer_id,
      work_folder_id: tokenRow.work_folder_id,
      channel: resolveFolderChannel(tokenRow.sent_channel),
      direction: 'inbound',
      status: 'completed',
      phone: null,
      summary,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_message_failed' }, { status: 500 });
  }

  // Notify the business owner's devices (best-effort; inert until FCM configured,
  // never throws). This is the ONLY notification for a folder question.
  await sendPushToBusinessOwner(tokenRow.business_id, {
    title: 'Νέο μήνυμα από πελάτη',
    body: `${folder.title} — ${buildQuestionPreview(message)}`,
    url: `/customers/${folder.customer_id}`,
    data: {
      type: 'folder_question',
      workFolderId: tokenRow.work_folder_id,
      customerId: folder.customer_id,
    },
  });

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

  try {
    // Mirrors loadPublicFolder's message query: only the customer↔business
    // channels (call excluded), only delivered/seen-class statuses, oldest-first.
    const { data, error } = await supabase
      .from('communications')
      .select('direction, channel, summary, created_at')
      .eq('business_id', tokenRow.business_id)
      .eq('work_folder_id', tokenRow.work_folder_id)
      .in('channel', ['sms', 'viber', 'email'])
      .in('status', ['completed', 'sent', 'delivered', 'seen'])
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) {
      return NextResponse.json({ ok: false, error: 'folder_messages_failed' }, { status: 500 });
    }
    const messages = mapPublicMessages(((data ?? []) as unknown[]) as MessageRowForPublic[]);

    // The customer is viewing the conversation → mark the owner's outbound
    // messages for this folder as read, and roll the token's last_visited_at.
    // Best-effort + tolerant: read_at / last_visited_at are migration 057, so a
    // missing column (pre-057) is ignored and read receipts just don't show yet.
    try {
      const ts = new Date().toISOString();
      await supabase
        .from('communications')
        .update({ read_at: ts })
        .eq('business_id', tokenRow.business_id)
        .eq('work_folder_id', tokenRow.work_folder_id)
        .eq('direction', 'outbound')
        .is('read_at', null);
      await supabase
        .from('customer_folder_tokens')
        .update({ last_visited_at: ts })
        .eq('id', tokenRow.id);
    } catch {
      // pre-057 schema → no read receipts yet
    }

    return NextResponse.json({ ok: true, messages }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_messages_failed' }, { status: 500 });
  }
}
