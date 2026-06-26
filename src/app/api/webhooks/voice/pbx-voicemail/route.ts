// PBX voicemail upload + transcription endpoint (F7, Quo "voicemail-to-text").
//
// SERVER-READY / INERT until the Asterisk side is wired: when a caller is not
// answered and leaves a message, the VPS dialplan records the voicemail WAV and
// uploads it here (multipart: audio + caller + uniqueid). We transcribe it with
// the SAME Deepgram→OpenAI pipeline used for call recordings and surface the
// Greek text on the customer timeline, so the owner READS the voicemail instead
// of dialing in to listen. See docs/VOICEMAIL_SETUP.md for the dialplan.
//
// Machine-to-machine: shared-secret guard (PBX_WEBHOOK_SECRET), fail-closed in
// production. Audio is held in RAM only and never persisted.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { transcribeAndBriefCallAudio } from '@/lib/server/openai-call-audio';
import { appendCallBrief } from '@/lib/server/call-briefs';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import {
  processPbxVoicemail,
  type PbxVoicemailInput,
} from '@/server/modules/webhooks-voice/webhooks-voice.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function getString(value: FormDataEntryValue | null): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s;
}

export async function POST(request: NextRequest) {
  // Shared-secret guard (same mechanism as pbx-recording).
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (!timingSafeEqualSecret(headerSecret, webhookSecret)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  }

  const businessId = process.env.PBX_BUSINESS_ID?.trim() ?? '';
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

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
  if (audioFile.size === 0) return NextResponse.json({ ok: false, error: 'empty_audio' }, { status: 400 });
  if (audioFile.size > MAX_AUDIO_BYTES) return NextResponse.json({ ok: false, error: 'audio_too_large' }, { status: 413 });

  const caller = normalizePhone(getString(formData.get('caller')) ?? getString(formData.get('from')));
  const uniqueid = getString(formData.get('uniqueid'));

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const input: PbxVoicemailInput = { audioFile, caller, uniqueid };

  return processPbxVoicemail(supabase, businessId, input, {
    transcribeAndBriefCallAudio,
    appendCallBrief,
    sendPushToBusinessOwner,
  });
}
