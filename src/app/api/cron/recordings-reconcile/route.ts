// Cron: reconcile pending Twilio recordings → AI briefs.
//
// The recording webhook persists a provider_webhook_events row (provider
// 'twilio', event_type 'recording_pending') whenever it cannot finish a
// recording: the communications row wasn't found yet, the download failed, or
// transcription failed. This job retries those events so EVERY recorded call
// eventually gets its brief — the product's core promise.
//
// Per event:
//   - call already briefed → mark processed, delete the cloud recording
//   - match + transcribe OK → mark processed, delete the cloud recording
//   - still failing and younger than GIVE_UP_HOURS → leave for the next run
//   - older than GIVE_UP_HOURS → give up: mark processed with the error and
//     delete the cloud recording (privacy: no copy outlives the pipeline)
//
// Auth: CRON_SECRET via Authorization: Bearer (Vercel Cron), x-cron-secret, or
// ?secret= — see src/lib/server/cron-auth.ts. Schedule lives in vercel.json.
//
// The per-event reconciliation logic lives in src/server/modules/cron
// (cron.service.ts → reconcileRecordings); this route stays a thin auth → env
// guard → service → response shell.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { getTwilioEnv } from '@/lib/server/twilio-recording';
import { reconcileRecordings } from '@/server/modules/cron/cron.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request, 'recordings-reconcile cron');
  if (denied) return denied;

  const env = getTwilioEnv();
  if (!env) {
    return NextResponse.json({ ok: true, skipped: 'twilio_not_configured' });
  }
  const { accountSid, authToken } = env;

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const result = await reconcileRecordings({ supabase, accountSid, authToken });

  if (result.kind === 'skip') {
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }
  if (result.kind === 'query_failed') {
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    examined: result.examined,
    succeeded: result.succeeded,
    deferred: result.deferred,
    gave_up: result.gaveUp,
  });
}
