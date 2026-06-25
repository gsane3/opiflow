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
import { appendCallBrief } from '@/lib/server/call-briefs';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';
import {
  processPbxRecording,
  type PbxRecordingInput,
} from '@/server/modules/webhooks-voice/webhooks-voice.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

function getString(value: FormDataEntryValue | null): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

/** `biz_<32hex>` endpoint identity → business UUID (multi-tenant resolution). */
function businessIdFromBizEndpoint(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/biz_([a-f0-9]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

  // Single-tenant fallback only; the real business is resolved per-call below
  // (from the communication_id row, then the biz_<hex> endpoint, then this env).
  const pbxBusinessIdFromEnv = process.env.PBX_BUSINESS_ID?.trim() || null;

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
  const bizEndpointId = businessIdFromBizEndpoint(
    getString(formData.get('endpoint')) ?? getString(formData.get('biz_id'))
  );

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

  const input: PbxRecordingInput = {
    audioFile,
    uniqueid,
    communicationIdParam,
    callerNumber,
    dialStatus,
    bizEndpointId,
    pbxBusinessIdFromEnv,
  };

  return processPbxRecording(supabase, input, {
    transcribeAndBriefCallAudio,
    appendCallBrief,
  });
}
