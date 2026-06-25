// Disclosure audio — repository (tenant data access). Parity-matched to
// /api/businesses/me/disclosure-audio.
//
// The clip lives inline on businesses.recording_disclosure_audio (a base64 data: URL —
// same approach as logo_url). The `businesses` table's PK *is* the id (no business_id
// column), so this hits ctx.supabase.from('businesses').eq('id', businessId) DIRECTLY,
// NOT tenantDb. Both operations are TOLERANT of migration 055 being unapplied: a
// "column/relation missing" PostgREST error is surfaced as a distinct migration-pending
// signal so the route can degrade exactly as the original did.

import { AppError } from '../../core/errors';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type Ctx = {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  businessId: string;
};

/** Treat a PostgREST "column/relation missing" error as "migration not applied yet". */
export function isMissingColumn(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || m.includes('recording_disclosure_audio');
}

/**
 * Read the current disclosure clip.
 *   - { migrationPending: true } when the column is absent (migration 055 pending).
 *   - { audio } (string|null) otherwise.
 * DB error (other than missing column) → query_failed (500).
 */
export async function getDisclosureAudio(
  ctx: Ctx,
): Promise<{ migrationPending: true } | { audio: string | null }> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('recording_disclosure_audio')
    .eq('id', ctx.businessId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return { migrationPending: true };
    throw new AppError('query_failed', 500);
  }
  const audio = (data as { recording_disclosure_audio?: string | null } | null)?.recording_disclosure_audio ?? null;
  return { audio };
}

/**
 * Persist the clip (or null to clear).
 *   - { migrationPending: true } when the column is absent (migration 055 pending).
 *   - { ok: true } on success.
 * DB error (other than missing column) → update_failed (500).
 */
export async function setDisclosureAudio(
  ctx: Ctx,
  value: string | null,
): Promise<{ migrationPending: true } | { ok: true }> {
  const { error } = await ctx.supabase
    .from('businesses')
    .update({ recording_disclosure_audio: value, updated_at: new Date().toISOString() })
    .eq('id', ctx.businessId);
  if (error) {
    if (isMissingColumn(error)) return { migrationPending: true };
    throw new AppError('update_failed', 500);
  }
  return { ok: true };
}
