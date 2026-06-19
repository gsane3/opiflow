// /api/businesses/me/disclosure-audio
//
// The per-business call-recording DISCLOSURE clip (the owner's own voice saying
// "η κλήση ηχογραφείται…"), stored inline on businesses.recording_disclosure_audio
// as a base64 data: URL — same approach as logo_url (the clip is short). The PBX
// reads the column, transcodes per business, and plays it before bridging.
//
//   GET → { ok, audio: dataUrl|null, configured: boolean, migrationPending?: true }
//   PUT → body { audio: string|null }  (data:audio/* base64, or null/'' to clear)
//
// Business-scoped (owner) via Bearer + resolveBusinessContext. TOLERANT of the
// column being absent (migration 055 not applied yet) → degrades cleanly.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';

export const runtime = 'nodejs';

// A few seconds of opus/aac is tens of KB; cap the base64 string generously but
// bounded so a runaway upload can't bloat the businesses row.
const MAX_AUDIO_DATAURL_LEN = 1_400_000; // ~1 MB binary
const AUDIO_DATAURL_RE = /^data:audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-m4a|aac)(;[a-z0-9-]+=[^;,]*)*;base64,[A-Za-z0-9+/=]+$/i;

/** Treat a PostgREST "column/relation missing" error as "migration not applied yet". */
function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || m.includes('recording_disclosure_audio');
}

async function authBusiness(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 }) };
  }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
  }
  const resolved = await resolveBusinessContext(supabase, user.id);
  if (!resolved) {
    return { error: NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 }) };
  }
  return { supabase, businessId: resolved.businessId };
}

export async function GET(request: NextRequest) {
  const a = await authBusiness(request);
  if ('error' in a) return a.error;
  try {
    const { data, error } = await a.supabase
      .from('businesses')
      .select('recording_disclosure_audio')
      .eq('id', a.businessId)
      .maybeSingle();
    if (error) {
      if (isMissingColumn(error)) {
        return NextResponse.json({ ok: true, audio: null, configured: false, migrationPending: true });
      }
      return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
    }
    const audio = (data as { recording_disclosure_audio?: string | null } | null)?.recording_disclosure_audio ?? null;
    return NextResponse.json({ ok: true, audio, configured: !!audio });
  } catch {
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  const a = await authBusiness(request);
  if ('error' in a) return a.error;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const raw = (body as Record<string, unknown>).audio;

  // null / '' clears the recording (revert to the global default disclosure).
  let value: string | null;
  if (raw === null || raw === '') {
    value = null;
  } else if (typeof raw === 'string') {
    if (raw.length > MAX_AUDIO_DATAURL_LEN) {
      return NextResponse.json({ ok: false, error: 'audio_too_large' }, { status: 400 });
    }
    if (!AUDIO_DATAURL_RE.test(raw)) {
      return NextResponse.json({ ok: false, error: 'invalid_audio' }, { status: 400 });
    }
    value = raw;
  } else {
    return NextResponse.json({ ok: false, error: 'invalid_audio' }, { status: 400 });
  }

  try {
    const { error } = await a.supabase
      .from('businesses')
      .update({ recording_disclosure_audio: value, updated_at: new Date().toISOString() })
      .eq('id', a.businessId);
    if (error) {
      if (isMissingColumn(error)) {
        return NextResponse.json({ ok: false, error: 'migration_pending' }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, configured: value !== null });
  } catch {
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
  }
}
