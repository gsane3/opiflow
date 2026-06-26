// Cron: drain the transactional outbox (Viber/SMS/push/webhook) with retries.
//
// Reads due `outbox_events` (migration 063), dispatches each through its per-kind
// sender (src/server/outbox), and lets the engine retry with backoff / dead-letter
// after maxAttempts / dedup on (business_id, dedup_key). This is the durable delivery
// path: a provider hiccup never loses a message, and a redelivered/​retried event
// never double-sends.
//
// GATED by WORKER_ENABLED: until it's set to '1' this endpoint is INERT (returns
// skipped), so merging + scheduling the cron changes nothing until the owner flips
// the flag. Adoption is incremental — send-sites start calling recordOutbox() to
// enqueue instead of sending inline; this worker delivers them.
//
// Machine-auth via CRON_SECRET, like the other crons.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { dispatchOutbox } from '@/server/outbox/outbox';
import { buildOutboxSenders } from '@/server/outbox/senders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request, 'outbox worker cron');
  if (denied) return denied;

  // INERT until explicitly enabled. Safe to schedule before adoption.
  if (process.env.WORKER_ENABLED !== '1') {
    return NextResponse.json({ ok: true, skipped: 'worker_disabled' });
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const senders = buildOutboxSenders({
    sendMessage: (p) => sendViaPreferredChannel(p),
    sendPush: (businessId, payload) => sendPushToBusinessOwner(businessId, payload),
  });

  const { sent, failed } = await dispatchOutbox(supabase, senders, {
    limit: 50,
    maxAttempts: 6,
    backoffMs: 60_000,
  });

  return NextResponse.json({ ok: true, sent, failed });
}
