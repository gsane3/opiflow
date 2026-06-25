// Cron: weekly activity summary push (F8, Quo "analytics" parity — distilled to
// ONE actionable nudge, not a dashboard).
//
// Once a week, push each business owner a single Greek summary of the last 7
// days: total calls, missed calls, and open follow-up tasks (dropped leads).
// Reuses the existing call/task data + push; no new tables, no UI.
//
// Auth: CRON_SECRET (Authorization: Bearer / x-cron-secret / ?secret=).
// Schedule lives in vercel.json. INERT until FCM push env is configured.
//
// The per-business summary logic lives in src/server/modules/cron
// (cron.service.ts → runWeeklySummary); this route stays a thin auth → push/env
// guard → service → response shell.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { isPushEnabled } from '@/lib/server/push';
import { runWeeklySummary } from '@/server/modules/cron/cron.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request, 'weekly-summary cron');
  if (denied) return denied;

  if (!isPushEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'push_not_configured' });
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const result = await runWeeklySummary({ supabase });
  if (result.kind === 'query_failed') {
    return NextResponse.json({ ok: false, error: 'businesses_query_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pushed: result.pushed, skipped: result.skipped, examined: result.examined });
}
