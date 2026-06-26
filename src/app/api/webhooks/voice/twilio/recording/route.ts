// Twilio RecordingStatusCallback receiver.
//
// ADOPTED to the modular pattern (src/server/modules/webhooks-voice-extra): the route
// keeps the env-gate, raw-form parsing, Twilio signature validation (verbatim — the
// twilio SDK lives here) and the missing-url / non-completed guards; once a completed
// recording with a CallSid is in hand it hands the service-role client + params to the
// service, which downloads the WAV, runs the SAME engine the PBX path uses
// (transcribeAndBriefCallAudio() — Deepgram diarization → OpenAI Greek brief → ai_draft
// task), saves the brief to communications.summary, and DELETES the Twilio cloud
// Recording after success (or a permanent failure). Audio + transcript are held in RAM
// only. Re-delivered callbacks for an already-briefed call are idempotent.
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
import { processTwilioRecording } from '@/server/modules/webhooks-voice/webhooks-voice.service';

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
  const rawParams: Record<string, string> = {};
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

  return processTwilioRecording(
    supabase,
    { accountSid, authToken, callSid, recordingUrl, recordingSid, fromNumber },
    { findCallCommunication, persistRecordingEvent, deleteTwilioRecording, downloadRecordingWav, processRecordingForCommunication },
  );
}
