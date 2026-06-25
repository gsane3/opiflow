// Voice-dictation transcription for the AI command assistant (the mic button).
// Accepts a base64 data-URL audio clip recorded on the device (mp4/aac on iOS,
// webm on Android/Chrome), transcribes it with OpenAI (Greek), and returns the
// text. The client then feeds that text to /api/ai/cmd as usual. Auth-gated to a
// signed-in user so the server OPENAI_API_KEY can't be burned by anonymous callers.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { runTranscribe } from '@/server/modules/ai/ai.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ~10 MB of base64 (a 60s clip is far smaller); guards memory/cost.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;
const rateStore = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const e = rateStore.get(key);
  if (!e || now >= e.resetAt) { rateStore.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  if (e.count >= RATE_MAX) return true;
  e.count += 1;
  return false;
}

async function requireUser(req: NextRequest): Promise<{ userId: string } | { error: NextResponse }> {
  const h = req.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return { error: NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 }) };
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try { supabase = createServerSupabaseClient(); } catch {
    return { error: NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 }) };
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(h.slice(7));
    if (error || !user) return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
    return { userId: user.id };
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) };
  }
}

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'm4a';
}

export async function POST(req: NextRequest) {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  const auth = await requireUser(req);
  if ('error' in auth) return auth.error;
  if (isRateLimited(auth.userId)) return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: 'no_api_key' }, { status: 503 });

  let raw: string;
  try {
    raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const audio = (body as { audio?: unknown })?.audio;
  if (typeof audio !== 'string') return NextResponse.json({ ok: false, error: 'missing_audio' }, { status: 400 });

  const m = audio.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return NextResponse.json({ ok: false, error: 'invalid_audio' }, { status: 400 });
  const mime = m[1].toLowerCase();
  let buf: Buffer;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return NextResponse.json({ ok: false, error: 'invalid_audio' }, { status: 400 }); }
  if (buf.length === 0) return NextResponse.json({ ok: false, error: 'empty_audio' }, { status: 400 });

  const outcome = await runTranscribe(apiKey, mime, buf);
  if (!outcome.ok) return NextResponse.json({ ok: false, error: outcome.code }, { status: outcome.status });
  return NextResponse.json({ ok: true, text: outcome.text });
}
