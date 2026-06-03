// PBX recording upload and transcription endpoint.
// Called by the VPS after the JSON webhook succeeds, with the WAV file attached.
// Transcribes audio with OpenAI, generates a Greek CRM brief, and updates
// the matching communications.summary row. Machine-to-machine only.
// Does not create customers, communications, or Viber messages.
// customers.needs_summary is intentionally NOT updated here (review-first principle).
//
// Track D: writes lifecycle audit timestamps (recording_received_at,
// transcription_started_at, brief_created_at, audio_discarded_at,
// transcript_discarded_at, processing_failed_at, processing_error_code)
// to the communications row. Audio and transcript are held in RAM only and
// are never written to storage or any database column.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

function getString(value: FormDataEntryValue | null): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/voice/pbx-recording
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Shared secret guard -- same mechanism as the JSON PBX webhook. Fail closed in
  // production unless ALLOW_INSECURE_WEBHOOKS=1 is set explicitly.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (!timingSafeEqualSecret(headerSecret, webhookSecret)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
    console.error('[pbx-recording webhook] PBX_WEBHOOK_SECRET is not set in production — rejecting. Set the secret (or ALLOW_INSECURE_WEBHOOKS=1 to override).');
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  } else {
    console.warn('[pbx-recording webhook] PBX_WEBHOOK_SECRET is not set — endpoint is UNAUTHENTICATED.');
  }

  const businessId = process.env.PBX_BUSINESS_ID?.trim() ?? '';
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

  // Parse multipart form data.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form_data' }, { status: 400 });
  }

  // Audio validation.
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

  // Accept WAV by filename, or allow common audio types and octet-stream.
  const audioFilename = (audioFile.name ?? '').toLowerCase();
  const audioType = (audioFile.type ?? '').toLowerCase();
  const isWavFilename = audioFilename.endsWith('.wav');
  const isAcceptableType =
    audioType.includes('wav') ||
    audioType.startsWith('audio/') ||
    audioType === 'application/octet-stream';
  if (!isWavFilename && !isAcceptableType) {
    return NextResponse.json({ ok: false, error: 'unsupported_audio_type' }, { status: 415 });
  }

  // Other form fields.
  const uniqueid = getString(formData.get('uniqueid'));
  const communicationIdParam = getString(formData.get('communication_id'));
  const callerNumber = getString(formData.get('caller_number'));
  const dialStatus = getString(formData.get('dialstatus'));

  if (!uniqueid && !communicationIdParam) {
    return NextResponse.json(
      { ok: false, error: 'missing_uniqueid_or_communication_id' },
      { status: 400 }
    );
  }

  // Supabase service-role client.
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }

  // ---------------------------------------------------------------------------
  // Find the matching communications row.
  // Prefer the explicit communication_id if provided.
  // Fall back to searching by uniqueid in the summary text.
  // ---------------------------------------------------------------------------
  let communicationId: string | null = null;
  let existingSummary: string | null = null;
  let communicationCustomerId: string | null = null;

  if (communicationIdParam) {
    const { data, error } = await supabase
      .from('communications')
      .select('id, summary, customer_id')
      .eq('id', communicationIdParam)
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
    }

    if (data) {
      const row = data as unknown as { id: string; summary: string | null; customer_id: string | null };
      communicationId = row.id;
      existingSummary = row.summary;
      communicationCustomerId = row.customer_id ?? null;
    }
  }

  if (!communicationId && uniqueid) {
    const { data, error } = await supabase
      .from('communications')
      .select('id, summary, customer_id')
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .like('summary', `%uniqueid=${uniqueid}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
    }

    if (data) {
      const row = data as unknown as { id: string; summary: string | null; customer_id: string | null };
      communicationId = row.id;
      existingSummary = row.summary;
      communicationCustomerId = row.customer_id ?? null;
    }
  }

  if (!communicationId) {
    // Return HTTP 200 so the PBX script does not treat this as a fatal error.
    return NextResponse.json({
      ok: false,
      received: true,
      error: 'communication_not_found',
    });
  }

  // Track D: record that audio was received and transcription is about to start.
  // Best-effort: failure here does not abort the pipeline.
  const auditNow = new Date().toISOString();
  await supabase
    .from('communications')
    .update({
      recording_received_at: auditNow,
      transcription_started_at: auditNow,
    })
    .eq('id', communicationId)
    .eq('business_id', businessId);

  // ---------------------------------------------------------------------------
  // Transcribe and generate brief.
  // ---------------------------------------------------------------------------
  const result = await transcribeAndBriefCallAudio({
    audioFile,
    callerNumber,
    dialStatus,
    uniqueId: uniqueid,
    communicationSummary: existingSummary,
  });

  if (!result) {
    await supabase
      .from('communications')
      .update({
        processing_failed_at: new Date().toISOString(),
        processing_error_code: 'transcription_or_brief_failed',
      })
      .eq('id', communicationId)
      .eq('business_id', businessId);
    // Return HTTP 200 so the PBX script does not treat this as a fatal error.
    return NextResponse.json({
      ok: false,
      received: true,
      error: 'transcription_failed',
    });
  }

  // Save only the concise brief. Transcript is intentionally excluded from CRM.
  // Audio and transcript were held in RAM only; these timestamps confirm they were not persisted.
  const briefNow = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('communications')
    .update({
      summary: result.brief,
      brief_created_at: briefNow,
      audio_discarded_at: briefNow,
      transcript_discarded_at: briefNow,
    })
    .eq('id', communicationId)
    .eq('business_id', businessId);

  if (updateError) {
    await supabase
      .from('communications')
      .update({
        processing_failed_at: new Date().toISOString(),
        processing_error_code: 'communication_update_failed',
      })
      .eq('id', communicationId)
      .eq('business_id', businessId);
    return NextResponse.json(
      { ok: false, error: 'communication_update_failed' },
      { status: 500 }
    );
  }

  // ---------------------------------------------------------------------------
  // Insert ai_draft task if customer is known and task data is available.
  // Non-blocking: failure here does not affect the communication update result.
  // ---------------------------------------------------------------------------
  let taskCreated = false;
  let taskId: string | null = null;
  let taskError: string | null = null;

  if (communicationCustomerId && result.taskTitle) {
    const { data: taskRow, error: taskInsertError } = await supabase
      .from('tasks')
      .insert({
        business_id: businessId,
        customer_id: communicationCustomerId,
        offer_id: null,
        title: result.taskTitle,
        type: result.taskType,
        status: 'ai_draft',
        priority: 'normal',
        due_date: result.taskDueDate,
        due_time: null,
        note: result.taskNote,
        created_from_ai: true,
        source_brief_id: communicationId,
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (taskInsertError || !taskRow) {
      taskError = 'task_create_failed';
      await supabase
        .from('communications')
        .update({
          processing_failed_at: new Date().toISOString(),
          processing_error_code: 'task_insert_failed',
        })
        .eq('id', communicationId)
        .eq('business_id', businessId);
    } else {
      taskCreated = true;
      taskId = (taskRow as unknown as { id: string }).id;
    }
  }

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: communicationId,
    task_created: taskCreated,
    task_id: taskId,
    ...(taskError ? { task_error: taskError } : {}),
    transcript_length: result.transcript.length,
    brief_length: result.brief.length,
  });
}
