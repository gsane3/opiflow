// Disclosure audio — service (validation + orchestration). Parity-matched to
// /api/businesses/me/disclosure-audio.
//
// The per-business call-recording DISCLOSURE clip (the owner's own voice saying
// "η κλήση ηχογραφείται…"), stored inline on businesses.recording_disclosure_audio as a
// base64 data: URL. The PUT validation (size cap + the audio data-URL shape) lives here
// and throws the route's EXACT codes (audio_too_large / invalid_audio, both 400) rather
// than a generic Zod error, so the response contract is unchanged. The thin storage read/
// write (and the migration-055 tolerance) lives in the repo.

import { AppError } from '../../core/errors';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { getDisclosureAudio, setDisclosureAudio } from './disclosure-audio.repo';

type Ctx = {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  businessId: string;
};

// A few seconds of opus/aac is tens of KB; cap the base64 string generously but
// bounded so a runaway upload can't bloat the businesses row.
export const MAX_AUDIO_DATAURL_LEN = 1_400_000; // ~1 MB binary
// Accept ANY audio/* data URL with codec params. iOS WKWebView MediaRecorder emits
// mimes like `audio/mp4;codecs="mp4a.40.2"` (quoted codecs) or subtypes outside a
// fixed whitelist — the previous strict pattern silently 400'd those valid clips, so
// recording "didn't work". We keep the hard `data:audio/…;base64,<base64>` shape (so
// non-audio / oversized payloads can't slip in) but allow arbitrary `;param` segments.
export const AUDIO_DATAURL_RE = /^data:audio\/[a-z0-9.+-]+(;[^;,]+)*;base64,[A-Za-z0-9+/=]+$/i;

/** GET — current clip. Mirrors the repo's migration-pending vs audio/configured outcome. */
export async function getAudio(
  ctx: Ctx,
): Promise<{ migrationPending: true } | { audio: string | null; configured: boolean }> {
  const result = await getDisclosureAudio(ctx);
  if ('migrationPending' in result) return { migrationPending: true };
  const audio = result.audio;
  return { audio, configured: !!audio };
}

/**
 * Validate the incoming `audio` field exactly as the route did, then persist it.
 *   - null / '' clears the clip (revert to the global default disclosure).
 *   - a string must be ≤ MAX_AUDIO_DATAURL_LEN (audio_too_large, 400) and match the
 *     audio data-URL shape (invalid_audio, 400); anything else → invalid_audio (400).
 * Returns { migrationPending: true } (pre-055) or { configured } on success.
 */
export async function putAudio(
  ctx: Ctx,
  raw: unknown,
): Promise<{ migrationPending: true } | { configured: boolean }> {
  let value: string | null;
  if (raw === null || raw === '') {
    value = null;
  } else if (typeof raw === 'string') {
    if (raw.length > MAX_AUDIO_DATAURL_LEN) {
      throw new AppError('audio_too_large', 400);
    }
    if (!AUDIO_DATAURL_RE.test(raw)) {
      throw new AppError('invalid_audio', 400);
    }
    value = raw;
  } else {
    throw new AppError('invalid_audio', 400);
  }

  const result = await setDisclosureAudio(ctx, value);
  if ('migrationPending' in result) return { migrationPending: true };
  return { configured: value !== null };
}
