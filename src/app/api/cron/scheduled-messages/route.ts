// Cron: dispatch due scheduled messages (F4).
//
// Sends every pending scheduled_messages row whose scheduled_for has passed,
// via the customer's preferred channel (Viber → SMS), logs it to the timeline,
// and marks it sent/failed.
//
// NOTE on granularity: the current Vercel plan only allows DAILY crons, so a
// scheduled message is dispatched at the next daily run after its time (good
// enough for appointment reminders). Move to an hourly schedule on a Pro plan
// for finer timing.
//
// NOTE on auto-cancel-on-reply: Opiflow does not yet capture inbound customer
// replies, so "cancel if the customer replies first" is not implemented; the
// owner can cancel a pending message manually.
//
// The dispatch logic lives in src/server/modules/cron (cron.service.ts →
// dispatchScheduledMessages); this route stays a thin auth → client guard →
// service → response shell.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { dispatchScheduledMessages } from '@/server/modules/cron/cron.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request, 'scheduled-messages cron');
  if (denied) return denied;

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const result = await dispatchScheduledMessages({ supabase });

  if (result.kind === 'skip') {
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }
  if (result.kind === 'query_failed') {
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, examined: result.examined, sent: result.sent, failed: result.failed });
}
