// Cron: weekly activity summary push (F8, Quo "analytics" parity — distilled to
// ONE actionable nudge, not a dashboard).
//
// Once a week, push each business owner a single Greek summary of the last 7
// days: total calls, missed calls, and open follow-up tasks (dropped leads).
// Reuses the existing call/task data + push; no new tables, no UI.
//
// Auth: CRON_SECRET (Authorization: Bearer / x-cron-secret / ?secret=).
// Schedule lives in vercel.json. INERT until FCM push env is configured.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { isPushEnabled, sendPushToBusinessOwner } from '@/lib/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FOLLOWUP_TYPES = ['call_back', 'follow_up_offer', 'send_offer', 'wait_for_reply'];

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

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: businesses, error } = await supabase.from('businesses').select('id');
  if (error) {
    return NextResponse.json({ ok: false, error: 'businesses_query_failed' }, { status: 500 });
  }

  let pushed = 0;
  let skipped = 0;

  for (const row of (businesses ?? []) as Array<{ id: string }>) {
    const businessId = row.id;
    try {
      // Owner opt-out (tolerate pre-044: column may not exist → treat as enabled).
      const { data: optRow, error: optErr } = await supabase
        .from('businesses')
        .select('weekly_summary_enabled')
        .eq('id', businessId)
        .maybeSingle();
      if (!optErr && (optRow as { weekly_summary_enabled?: boolean } | null)?.weekly_summary_enabled === false) {
        skipped += 1;
        continue;
      }

      const [callsRes, missedRes, tasksRes] = await Promise.all([
        supabase
          .from('communications')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('channel', 'call')
          .gte('created_at', weekAgoIso),
        supabase
          .from('communications')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('channel', 'call')
          .in('status', ['missed', 'failed'])
          .gte('created_at', weekAgoIso),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('status', 'open')
          .in('type', FOLLOWUP_TYPES),
      ]);

      const calls = callsRes.count ?? 0;
      const missed = missedRes.count ?? 0;
      const openFollowups = tasksRes.count ?? 0;

      // Nothing happened and nothing pending → don't nag.
      if (calls === 0 && openFollowups === 0) {
        skipped += 1;
        continue;
      }

      const parts: string[] = [`${calls} κλήσεις`];
      if (missed > 0) parts.push(`${missed} αναπάντητες`);
      if (openFollowups > 0) parts.push(`${openFollowups} εκκρεμότητες`);

      await sendPushToBusinessOwner(businessId, {
        title: 'Η εβδομάδα σου στο Opiflow',
        body: parts.join(' · '),
        url: openFollowups > 0 ? '/tasks' : '/dashboard',
        data: { type: 'weekly_summary' },
      });
      pushed += 1;
    } catch {
      // never let one business fail the run
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, pushed, skipped, examined: (businesses ?? []).length });
}
