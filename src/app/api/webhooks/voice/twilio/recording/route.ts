// Twilio RecordingStatusCallback receiver.
//
// When a Twilio-recorded call leg finishes, Twilio POSTs (form-urlencoded) the
// RecordingUrl + CallSid here. We download the WAV (Basic auth) and run it
// through the SAME engine the PBX path uses — transcribeAndBriefCallAudio()
// (Deepgram diarization → OpenAI Greek brief → ai_draft task) — then save the
// brief to communications.summary. Audio + transcript are held in RAM only,
// and the Twilio cloud Recording is DELETED after successful processing (or a
// permanent failure) so no copy of the call outlives the pipeline.
//
// Reliability: the communications row is created at DIAL time by the outbound
// TwiML webhook (provider_call_id = CallSid), so matching normally succeeds.
// If it still doesn't (or transcription fails), the event is persisted into
// provider_webhook_events and the recordings-reconcile cron retries — the
// recording is kept at Twilio until then. Re-delivered callbacks for an
// already-briefed call are idempotent (skip + cleanup).
//
// ENV-GATED + INERT: returns 503 'twilio_not_configured' until TWILIO_AUTH_TOKEN
// + TWILIO_ACCOUNT_SID are set, so nothing runs before Twilio is wired.

import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  deleteTwilioRecording,
  downloadRecordingWav,
  findCallCommunication,
  getTwilioEnv,
  persistRecordingEvent,
  processRecordingForCommunication,
} from '@/lib/server/twilio-recording';

export const runtime = 'nodejs';
export const maxDuration = 120;

function str(v: FormDataEntryValue | null | undefined): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

export async function POST(request: NextRequest) {
  const env = getTwilioEnv();
  if (!env) {
    return NextResponse.json({ ok: false, error: 'twilio_not_configured' }, { status: 503 });
  }
  const { accountSid, authToken } = env;

  // Read the raw form so we can both validate the signature and read params.
  let form: URLSearchParams;
  let rawParams: Record<string, string> = {};
  try {
    const raw = await request.text();
    form = new URLSearchParams(raw);
    form.forEach((value, key) => { rawParams[key] = value; });
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form' }, { status: 400 });
  }

  // Validate Twilio's signature (fail-closed in production unless explicitly
  // overridden). The signed URL must match what is configured in the Twilio
  // console — set TWILIO_RECORDING_WEBHOOK_URL to that exact public URL.
  const signature = request.headers.get('x-twilio-signature') ?? '';
  const signedUrl = process.env.TWILIO_RECORDING_WEBHOOK_URL?.trim() || request.url;
  const validSig = (() => {
    try {
      return twilio.validateRequest(authToken, signature, signedUrl, rawParams);
    } catch {
      return false;
    }
  })();
  if (!validSig) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }
    console.warn('[twilio recording webhook] signature not validated — proceeding (non-production / override).');
  }

  const callSid = str(form.get('CallSid'));
  const recordingUrl = str(form.get('RecordingUrl'));
  const recordingSid = str(form.get('RecordingSid'));
  const recordingStatus = str(form.get('RecordingStatus'));
  const fromNumber = str(form.get('From'));

  // Only act on a completed recording with a media URL + a CallSid to match on.
  if (!recordingUrl || !callSid) {
    return NextResponse.json({ ok: true, received: true, error: 'missing_recording_url_or_call_sid' });
  }
  if (recordingStatus && recordingStatus !== 'completed') {
    return NextResponse.json({ ok: true, received: true, status: recordingStatus });
  }

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const comm = await findCallCommunication(supabase, callSid);

  if (!comm) {
    // Not logged yet (e.g. the dial-time insert failed) — persist for the
    // reconcile cron and keep the recording at Twilio until it succeeds.
    await persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'communication_not_found',
    });
    return NextResponse.json({ ok: true, received: true, error: 'communication_not_found' });
  }

  // Idempotency: a re-delivered callback for an already-briefed call only
  // needs the cloud-side cleanup.
  if (comm.brief_created_at) {
    if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
    return NextResponse.json({ ok: true, received: true, already_processed: true });
  }

  const download = await downloadRecordingWav(recordingUrl, accountSid, authToken);
  if ('error' in download) {
    if (download.error === 'size_invalid') {
      // Unusable audio — never retryable; delete the cloud copy.
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      return NextResponse.json({ ok: true, received: true, error: 'recording_size_invalid' });
    }
    await persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'download_failed',
    });
    return NextResponse.json({ ok: true, received: true, error: 'recording_download_failed' });
  }

  const ok = await processRecordingForCommunication({
    supabase,
    comm,
    audioFile: download.file,
    fromNumber,
    callSid,
  });

  if (!ok) {
    // Transient Deepgram/OpenAI failure — schedule a retry, keep the recording.
    await persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'transcription_failed',
    });
    return NextResponse.json({ ok: true, received: true, error: 'transcription_failed' });
  }

  // Success — the brief is in the CRM; remove the cloud copy (privacy + cost).
  if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: comm.id,
  });
}
