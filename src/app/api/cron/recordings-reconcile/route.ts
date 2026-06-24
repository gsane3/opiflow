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

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { log } from '@/lib/observability';
import {
  deleteTwilioRecording,
  downloadRecordingWav,
  findCallCommunication,
  getTwilioEnv,
  processRecordingForCommunication,
} from '@/lib/server/twilio-recording';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BATCH_LIMIT = 10;
const GIVE_UP_HOURS = 48;

interface PendingEvent {
  id: string;
  created_at: string;
  payload: {
    call_sid?: string;
    recording_url?: string;
    recording_sid?: string | null;
    from_number?: string | null;
  } | null;
}

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

  const { data, error } = await supabase
    .from('provider_webhook_events')
    .select('id, created_at, payload')
    .eq('provider', 'twilio')
    .eq('event_type', 'recording_pending')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    // ONLY a missing table is a benign skip; any other error means the brief
    // reconciliation is broken — surface it (500) instead of silently dropping
    // recordings that never get their AI brief.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({ ok: true, skipped: 'events_unavailable' });
    }
    log.error('cron_recordings_reconcile_query_failed', { code: error.code });
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }

  const events = (data ?? []) as unknown as PendingEvent[];
  let succeeded = 0;
  let gaveUp = 0;
  let deferred = 0;

  for (const event of events) {
    const callSid = event.payload?.call_sid;
    const recordingUrl = event.payload?.recording_url;
    const recordingSid = event.payload?.recording_sid ?? null;
    const fromNumber = event.payload?.from_number ?? null;
    const ageHours = (Date.now() - new Date(event.created_at).getTime()) / 3_600_000;

    const markProcessed = async (errorMessage: string | null) => {
      await supabase
        .from('provider_webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString(), error_message: errorMessage })
        .eq('id', event.id);
    };

    if (!callSid || !recordingUrl) {
      await markProcessed('invalid_payload');
      continue;
    }

    const giveUp = async (reason: string) => {
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(reason);
      gaveUp += 1;
    };

    const comm = await findCallCommunication(supabase, callSid);

    if (comm?.brief_created_at) {
      // Already briefed elsewhere — just clean up.
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(null);
      succeeded += 1;
      continue;
    }

    if (!comm) {
      if (ageHours > GIVE_UP_HOURS) await giveUp('communication_never_found');
      else deferred += 1;
      continue;
    }

    const download = await downloadRecordingWav(recordingUrl, accountSid, authToken);
    if ('error' in download) {
      if (download.error === 'size_invalid') await giveUp('recording_size_invalid');
      else if (ageHours > GIVE_UP_HOURS) await giveUp('download_failed');
      else deferred += 1;
      continue;
    }

    const ok = await processRecordingForCommunication({
      supabase,
      comm,
      audioFile: download.file,
      fromNumber,
      callSid,
    });

    if (ok) {
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(null);
      succeeded += 1;
    } else if (ageHours > GIVE_UP_HOURS) {
      await giveUp('transcription_failed');
    } else {
      deferred += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    examined: events.length,
    succeeded,
    deferred,
    gave_up: gaveUp,
  });
}
