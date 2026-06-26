// GET|POST /api/cron/folder-unread-reminder
//
// Daily, system-wide cron (gated by CRON_SECRET via the shared guard). Nudges
// the business owner when a message they sent the customer in the shared-link
// portal has stayed UNREAD for ~24h (the customer never opened the chat).
//
// "Unread" = communications.read_at IS NULL on an OUTBOUND portal message. The
// public chat-view GET sets read_at when the customer opens the thread, so a
// null read_at means they haven't looked. We only nag messages aged 24h–48h so
// each unread message produces at most ~1 reminder, then ages out — no infinite
// daily nagging and no extra bookkeeping column needed.
//
// read_at is migration 057 (applied manually). Until then the candidate query
// errors on the missing column and we no-op gracefully.
//
// Post-auth job logic lives in src/server/modules/cron (cron.service.ts →
// runFolderUnreadSweep); this route stays a thin auth → service → response shell.

import { NextRequest, NextResponse } from 'next/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { runFolderUnreadSweep } from '@/server/modules/cron/cron.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest): Promise<NextResponse> {
  const gate = checkCronSecret(request, 'folder-unread-reminder cron');
  if (gate) return gate;
  try {
    const result = await runFolderUnreadSweep();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    console.error('[folder-unread-reminder cron] unexpected failure:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, nudged: 0, reason: 'server_error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
