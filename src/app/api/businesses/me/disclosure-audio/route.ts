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
// ADOPTED to the modular pattern (src/server/modules/disclosure-audio): thin adapter.
// The mime/data-url + size validation and the migration-055-tolerant read/write live in
// the service+repo. The route KEEPS its custom Bearer auth VERBATIM (the caller may not
// belong to a business; same missing_auth/invalid_auth/missing_supabase_config/
// business_not_found codes), the content-type + owner/admin gates, and the exact GET/PUT
// response shapes and statuses. Byte-identical.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext, isManagerRole } from '@/lib/api/auth';
import { AppError } from '@/server/core/errors';
import { getAudio, putAudio } from '@/server/modules/disclosure-audio/disclosure-audio.service';

export const runtime = 'nodejs';

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
  return { supabase, businessId: resolved.businessId, role: resolved.role };
}

export async function GET(request: NextRequest) {
  const a = await authBusiness(request);
  if ('error' in a) return a.error;
  try {
    const result = await getAudio({ supabase: a.supabase, businessId: a.businessId });
    if ('migrationPending' in result) {
      return NextResponse.json({ ok: true, audio: null, configured: false, migrationPending: true });
    }
    return NextResponse.json({ ok: true, audio: result.audio, configured: result.configured });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: err.status });
    }
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
  // Changing the recording-disclosure clip is a consent setting — owner/admin only.
  if (!isManagerRole(a.role)) {
    return NextResponse.json({ ok: false, error: 'forbidden_admin_only' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const raw = (body as Record<string, unknown>).audio;

  try {
    const result = await putAudio({ supabase: a.supabase, businessId: a.businessId }, raw);
    if ('migrationPending' in result) {
      return NextResponse.json({ ok: false, error: 'migration_pending' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, configured: result.configured });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
  }
}
