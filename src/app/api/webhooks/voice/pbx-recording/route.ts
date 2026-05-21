// PBX recording upload and transcription endpoint.
// Called by the VPS after the JSON webhook succeeds, with the WAV file attached.
// Transcribes audio with OpenAI, generates a Greek CRM brief, and updates
// the matching communications.summary row. Machine-to-machine only.
// Does not create customers, communications, or Viber messages.
// customers.needs_summary is intentionally NOT updated here (review-first principle).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';

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
  // Shared secret guard -- same mechanism as the JSON PBX webhook.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (headerSecret !== webhookSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
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

  if (communicationIdParam) {
    const { data, error } = await supabase
      .from('communications')
      .select('id, summary')
      .eq('id', communicationIdParam)
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
    }

    if (data) {
      const row = data as unknown as { id: string; summary: string | null };
      communicationId = row.id;
      existingSummary = row.summary;
    }
  }

  if (!communicationId && uniqueid) {
    const { data, error } = await supabase
      .from('communications')
      .select('id, summary')
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
      const row = data as unknown as { id: string; summary: string | null };
      communicationId = row.id;
      existingSummary = row.summary;
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
    // Return HTTP 200 so the PBX script does not treat this as a fatal error.
    return NextResponse.json({
      ok: false,
      received: true,
      error: 'transcription_failed',
    });
  }

  // ---------------------------------------------------------------------------
  // Build updated summary: brief + transcript prepended, existing summary kept
  // for diagnostics.
  // ---------------------------------------------------------------------------
  const updatedSummary = [
    result.brief,
    '',
    'Transcript:',
    result.transcript,
    '',
    '---',
    'Previous summary:',
    existingSummary ?? '(none)',
  ].join('\n');

  const { error: updateError } = await supabase
    .from('communications')
    .update({ summary: updatedSummary })
    .eq('id', communicationId)
    .eq('business_id', businessId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: 'communication_update_failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: communicationId,
    transcript_length: result.transcript.length,
    brief_length: result.brief.length,
  });
}
