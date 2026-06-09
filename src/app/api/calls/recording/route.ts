// Receives an in-app (browser/jsSIP) call recording, transcribes it with OpenAI,
// and upgrades the call's communication row from a metadata brief to a richer
// transcript brief — reusing the same pipeline as the PBX recording webhook.
//
// Consent-first: the client only uploads when the operator has the recording
// setting enabled AND has been reminded to announce it to the customer; the
// upload carries a consent marker. The audio is held in RAM only for the
// duration of the request and is never written to storage or any DB column
// (only the derived Greek brief text is persisted) — same posture as the PBX path.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';
import { appendCallBrief } from '@/lib/server/call-briefs';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form_data' }, { status: 400 });
  }

  const audioEntry = formData.get('audio');
  if (!audioEntry || typeof audioEntry === 'string') {
    return NextResponse.json({ ok: false, error: 'missing_audio' }, { status: 400 });
  }
  const audioFile = audioEntry as File;
  if (audioFile.size === 0) {
    return NextResponse.json({ ok: false, error: 'empty_audio' }, { status: 400 });
  }
  if (audioFile.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ ok: false, error: 'audio_too_large' }, { status: 413 });
  }

  const communicationId = str(formData.get('communicationId'));
  const callerNumber = str(formData.get('phone'));
  const dialStatus = str(formData.get('status'));
  if (!communicationId) {
    return NextResponse.json({ ok: false, error: 'missing_communication_id' }, { status: 400 });
  }

  // Confirm the communication belongs to this business and is a call.
  const { data: comm } = await supabase
    .from('communications')
    .select('id, summary, customer_id')
    .eq('id', communicationId)
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .maybeSingle();
  if (!comm) {
    return NextResponse.json({ ok: false, error: 'communication_not_found' }, { status: 404 });
  }
  const row = comm as unknown as { id: string; summary: string | null; customer_id: string | null };

  // Transcribe + brief. Audio is processed in memory and discarded after this call.
  let result: Awaited<ReturnType<typeof transcribeAndBriefCallAudio>> = null;
  try {
    result = await transcribeAndBriefCallAudio({
      audioFile,
      callerNumber,
      dialStatus,
      uniqueId: null,
      communicationSummary: row.summary,
    });
  } catch {
    result = null;
  }
  if (!result) {
    // 200 so the client keeps the already-saved metadata brief without erroring.
    return NextResponse.json({ ok: false, error: 'transcription_unavailable' }, { status: 200 });
  }

  // Upgrade the call's summary to the transcript brief (review-first).
  const newSummary = `${result.brief}\n\n---\n(in-app ηχογράφηση με συγκατάθεση)`;
  await supabase
    .from('communications')
    .update({ summary: newSummary })
    .eq('id', row.id)
    .eq('business_id', businessId);

  // Append the transcript brief to the per-call brief timeline (non-fatal) so the
  // earlier metadata brief is preserved as history rather than overwritten.
  await appendCallBrief(supabase, {
    businessId,
    customerId: row.customer_id,
    communicationId: row.id,
    briefKind: 'transcript',
    briefText: result.brief,
  });

  // Create the derived next-action task (review-first, AI-generated). Non-fatal.
  let taskId: string | null = null;
  try {
    const { data: taskRow } = await supabase
      .from('tasks')
      .insert({
        business_id: businessId,
        customer_id: row.customer_id,
        title: result.taskTitle,
        type: result.taskType,
        status: 'open',
        priority: 'normal',
        due_date: result.taskDueDate,
        note: result.taskNote,
        created_from_ai: true,
      })
      .select('id')
      .single();
    taskId = (taskRow as { id?: string } | null)?.id ?? null;
  } catch {
    // non-fatal — the brief is already saved
  }

  return NextResponse.json({ ok: true, brief: result.brief, taskId });
}
