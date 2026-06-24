// Twilio recording processing — shared by the RecordingStatusCallback webhook
// and the recordings-reconcile cron.
//
// Privacy posture: the WAV is held in RAM only while transcribing; after a
// SUCCESSFUL brief (or a permanent failure) the Twilio cloud Recording resource
// is DELETED so no copy of the customer's call outlives processing. While a
// retry is still possible the recording is intentionally kept at Twilio.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';
import { appendCallBrief } from '@/lib/server/call-briefs';

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

export interface CallCommRow {
  id: string;
  business_id: string;
  summary: string | null;
  customer_id: string | null;
  brief_created_at: string | null;
}

export function getTwilioEnv(): { accountSid: string; authToken: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

/** Find the call's communications row by Twilio CallSid (exact column first, legacy summary marker second). */
export async function findCallCommunication(
  supabase: SupabaseServer,
  callSid: string
): Promise<CallCommRow | null> {
  const cols = 'id, business_id, summary, customer_id, brief_created_at';
  const byId = await supabase
    .from('communications')
    .select(cols)
    .eq('channel', 'call')
    .eq('provider_call_id', callSid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byId.data) return byId.data as unknown as CallCommRow;

  const bySummary = await supabase
    .from('communications')
    .select(cols)
    .eq('channel', 'call')
    .like('summary', `%twilio_sid=${callSid}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (bySummary.data as unknown as CallCommRow) ?? null;
}

/** Download the recording WAV into RAM. */
export async function downloadRecordingWav(
  recordingUrl: string,
  accountSid: string,
  authToken: string
): Promise<{ file: File } | { error: 'download_failed' | 'size_invalid' }> {
  try {
    // SSRF defense-in-depth: the Twilio Basic-auth credentials must NEVER be sent
    // to a non-Twilio host, even if webhook signature validation were bypassed.
    let url: URL;
    try {
      url = new URL(`${recordingUrl}.wav`);
    } catch {
      return { error: 'download_failed' };
    }
    if (url.protocol !== 'https:' || !/(^|\.)twilio\.com$/.test(url.hostname)) {
      return { error: 'download_failed' };
    }
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) return { error: 'download_failed' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) return { error: 'size_invalid' };
    return { file: new File([buf], 'twilio-recording.wav', { type: 'audio/wav' }) };
  } catch {
    return { error: 'download_failed' };
  }
}

/** Delete the Twilio cloud Recording resource. 404 counts as success (already gone). */
export async function deleteTwilioRecording(
  recordingSid: string,
  accountSid: string,
  authToken: string
): Promise<boolean> {
  try {
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${encodeURIComponent(recordingSid)}.json`,
      { method: 'DELETE', headers: { Authorization: `Basic ${basic}` } }
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Run the audio through the Deepgram → OpenAI brief engine and persist the
 * result on the communications row (+ brief history + ai_draft task).
 * On failure stamps processing_failed_at and returns false (caller decides
 * whether to schedule a retry).
 */
export async function processRecordingForCommunication(args: {
  supabase: SupabaseServer;
  comm: CallCommRow;
  audioFile: File;
  fromNumber: string | null;
  callSid: string;
}): Promise<boolean> {
  const { supabase, comm, audioFile, fromNumber, callSid } = args;

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
      .update({
        processing_failed_at: new Date().toISOString(),
        processing_error_code: 'transcription_or_brief_failed',
      })
      .eq('id', comm.id)
      .eq('business_id', comm.business_id);
    return false;
  }

  const briefNow = new Date().toISOString();
  await supabase
    .from('communications')
    .update({
      summary: result.brief,
      brief_created_at: briefNow,
      audio_discarded_at: briefNow,
      transcript_discarded_at: briefNow,
      processing_failed_at: null,
      processing_error_code: null,
    })
    .eq('id', comm.id)
    .eq('business_id', comm.business_id);

  await appendCallBrief(supabase, {
    businessId: comm.business_id,
    customerId: comm.customer_id,
    communicationId: comm.id,
    briefKind: 'transcript',
    briefText: result.brief,
  });

  if (comm.customer_id && result.taskTitle) {
    await supabase.from('tasks').insert({
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
    });
  }

  return true;
}

/**
 * Persist a recording event for later reconciliation (no matching row yet, or
 * transcription failed). Idempotent via the (provider, event_id) unique index;
 * fails silently pre-migration-043 (provider 'twilio' not yet allowed).
 */
export async function persistRecordingEvent(
  supabase: SupabaseServer,
  args: { callSid: string; recordingUrl: string; recordingSid: string | null; fromNumber: string | null; reason: string }
): Promise<void> {
  try {
    await supabase.from('provider_webhook_events').insert({
      provider: 'twilio',
      event_id: `rec_${args.recordingSid ?? args.callSid}`,
      event_type: 'recording_pending',
      payload: {
        call_sid: args.callSid,
        recording_url: args.recordingUrl,
        recording_sid: args.recordingSid,
        from_number: args.fromNumber,
        reason: args.reason,
      },
      processed: false,
    });
  } catch {
    // duplicate event or pre-043 schema — both fine to ignore
  }
}
