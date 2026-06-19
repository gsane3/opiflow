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

import { NextRequest, NextResponse } from 'next/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { sendPushToBusinessOwner } from '@/lib/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_START_MS = 48 * 60 * 60 * 1000; // oldest message we still nag about
const WINDOW_END_MS = 24 * 60 * 60 * 1000; // unread for at least this long
const BATCH_LIMIT = 100;

interface UnreadRow {
  business_id: string;
  work_folder_id: string;
  customer_id: string | null;
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('read_at') || (msg.includes('column') && msg.includes('does not exist'));
}

async function runSweep(): Promise<{ ok: boolean; nudged: number; reason?: string }> {
  const supabase = createServiceSupabaseClient();
  const now = Date.now();
  const olderThanIso = new Date(now - WINDOW_END_MS).toISOString();
  const newerThanIso = new Date(now - WINDOW_START_MS).toISOString();

  const { data, error } = await supabase
    .from('communications')
    .select('business_id, work_folder_id, customer_id')
    .is('read_at', null)
    .eq('direction', 'outbound')
    .not('work_folder_id', 'is', null)
    .in('channel', ['sms', 'viber', 'email'])
    .lt('created_at', olderThanIso)
    .gt('created_at', newerThanIso)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    if (isMissingColumnError(error)) return { ok: true, nudged: 0, reason: 'migration_057_pending' };
    console.error('[folder-unread-reminder cron] query failed:', error.message);
    return { ok: false, nudged: 0, reason: 'query_failed' };
  }

  const rows = (data ?? []) as UnreadRow[];
  // One nudge per folder, even if several messages are unread.
  const seen = new Set<string>();
  let nudged = 0;

  for (const row of rows) {
    if (seen.has(row.work_folder_id)) continue;
    seen.add(row.work_folder_id);
    try {
      const { data: folder } = await supabase
        .from('work_folders')
        .select('title, customer_id')
        .eq('id', row.work_folder_id)
        .eq('business_id', row.business_id)
        .maybeSingle();
      const f = folder as { title: string | null; customer_id: string | null } | null;
      const customerId = row.customer_id ?? f?.customer_id ?? null;
      await sendPushToBusinessOwner(row.business_id, {
        title: 'Αδιάβαστο μήνυμα',
        body: `${f?.title ?? 'Έργο'} — ο πελάτης δεν έχει δει ακόμα το μήνυμά σου.`,
        url: customerId ? `/customers/${customerId}` : '/calls',
        data: { type: 'folder_unread', workFolderId: row.work_folder_id, customerId: customerId ?? '' },
      });
      nudged += 1;
    } catch (err) {
      console.error(
        '[folder-unread-reminder cron] nudge failed for folder',
        row.work_folder_id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { ok: true, nudged };
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const gate = checkCronSecret(request, 'folder-unread-reminder cron');
  if (gate) return gate;
  try {
    const result = await runSweep();
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
