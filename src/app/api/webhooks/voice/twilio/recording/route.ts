// Twilio RecordingStatusCallback receiver.
//
// When a Twilio-recorded call leg finishes, Twilio POSTs (form-urlencoded) the
// RecordingUrl + CallSid here. We download the WAV (Basic auth) and run it
// through the SAME engine the PBX path uses — transcribeAndBriefCallAudio()
// (Deepgram diarization → OpenAI Greek brief → ai_draft task) — then save the
// brief to communications.summary. Audio + transcript are held in RAM only.
//
// ENV-GATED + INERT: returns 503 'twilio_not_configured' until TWILIO_AUTH_TOKEN
// + TWILIO_ACCOUNT_SID are set, so nothing runs before Twilio is wired.
//
// Matching: the communications row is found by the Twilio CallSid, which the
// call-logging path (Phase 3/4) stamps into the summary as `twilio_sid=<CallSid>`
// (mirrors the PBX `uniqueid=` marker). Until calls are logged with their SID
// this webhook simply ACKs (received) without matching — it never errors.

import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';
import { appendCallBrief } from '@/lib/server/call-briefs';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

function str(v: FormDataEntryValue | null | undefined): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

export async function POST(request: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return NextResponse.json({ ok: false, error: 'twilio_not_configured' }, { status: 503 });
  }

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

  // Find the communications row by the Twilio CallSid. Prefer the exact
  // provider_call_id column (migration 038); fall back to the legacy summary
  // marker (`twilio_sid=<CallSid>`) so this keeps working pre-038.
  type CommRow = { id: string; business_id: string; summary: string | null; customer_id: string | null };
  let comm: CommRow | null = null;
  {
    const byId = await supabase
      .from('communications')
      .select('id, business_id, summary, customer_id')
      .eq('channel', 'call')
      .eq('provider_call_id', callSid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byId.data) comm = byId.data as unknown as CommRow;
  }
  if (!comm) {
    const bySummary = await supabase
      .from('communications')
      .select('id, business_id, summary, customer_id')
      .eq('channel', 'call')
      .like('summary', `%twilio_sid=${callSid}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bySummary.data) comm = bySummary.data as unknown as CommRow;
  }

  if (!comm) {
    // ACK so Twilio does not retry forever; the call may not be logged yet.
    return NextResponse.json({ ok: true, received: true, error: 'communication_not_found' });
  }

  // Download the recording WAV (Twilio Basic auth).
  let audioFile: File;
  try {
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(`${recordingUrl}.wav`, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) {
      return NextResponse.json({ ok: true, received: true, error: 'recording_download_failed' });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ ok: true, received: true, error: 'recording_size_invalid' });
    }
    audioFile = new File([buf], 'twilio-recording.wav', { type: 'audio/wav' });
  } catch {
    return NextResponse.json({ ok: true, received: true, error: 'recording_download_error' });
  }

  const auditNow = new Date().toISOString();
  await supabase
    .from('communications')
    .update({ recording_received_at: auditNow, transcription_started_at: auditNow })
    .eq('id', comm.id)
    .eq('business_id', comm.business_id);

  const result = await transcribeAndBriefCallAudio({
    audioFile,
    callerNumber: fromNumber,
    dialStatus: null,
    uniqueId: callSid,
    communicationSummary: comm.summary,
  });

  if (!result) {
    await supabase
      .from('communications')
      .update({ processing_failed_at: new Date().toISOString(), processing_error_code: 'transcription_or_brief_failed' })
      .eq('id', comm.id)
      .eq('business_id', comm.business_id);
    return NextResponse.json({ ok: true, received: true, error: 'transcription_failed' });
  }

  const briefNow = new Date().toISOString();
  await supabase
    .from('communications')
    .update({
      summary: result.brief,
      brief_created_at: briefNow,
      audio_discarded_at: briefNow,
      transcript_discarded_at: briefNow,
    })
    .eq('id', comm.id)
    .eq('business_id', comm.business_id);

  // Append to the per-call brief timeline (non-fatal) — preserves history.
  await appendCallBrief(supabase, {
    businessId: comm.business_id,
    customerId: comm.customer_id,
    communicationId: comm.id,
    briefKind: 'transcript',
    briefText: result.brief,
  });

  // ai_draft task when the customer is known (mirrors the PBX path).
  let taskCreated = false;
  if (comm.customer_id && result.taskTitle) {
    const { data: taskRow } = await supabase
      .from('tasks')
      .insert({
        business_id: comm.business_id,
        customer_id: comm.customer_id,
        offer_id: null,
        title: result.taskTitle,
        type: result.taskType,
        status: 'ai_draft',
        priority: 'normal',
        due_date: result.taskDueDate,
        due_time: null,
        note: result.taskNote,
        created_from_ai: true,
        source_brief_id: comm.id,
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    taskCreated = Boolean(taskRow);
  }

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: comm.id,
    task_created: taskCreated,
  });
}
