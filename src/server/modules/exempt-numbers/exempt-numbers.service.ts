// Exempt-numbers — service (table logic for /api/businesses/me/exempt-numbers).
//
// DEFERRED-EDGE adoption: the route keeps its bespoke `authBusiness` VERBATIM (its
// local auth does NOT wrap supabase.auth.getUser in try/catch, so a getUser THROW
// bubbles to the per-method catch → query_failed/insert_failed/delete_failed 500,
// whereas requireBusinessUser would catch it → invalid_auth 401 — a different edge
// contract). Only the per-business EXEMPTION-list table access (list / upsert / delete,
// with the migration-060-absent tolerance) is extracted here. Each function returns a
// discriminated result the route maps to the exact byte-identical NextResponse.
//
// The `business_exempt_numbers` table is keyed by `business_id`; every query carries
// its explicit .eq('business_id', …) exactly as the original route did.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// Cap the list so a runaway "select all contacts" can't insert unbounded rows.
export const MAX_NUMBERS = 2000;

export const last10 = (s: unknown): string =>
  (typeof s === 'string' ? s.replace(/\D/g, '').slice(-10) : '');

/** Treat a PostgREST "relation missing" error as "migration 060 not applied yet". */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42P01' || err.code === 'PGRST205' || m.includes('business_exempt_numbers');
}

export interface ExemptRow {
  business_id: string;
  phone: string;
  label: string | null;
}

export type ListResult =
  | { kind: 'ok'; numbers: unknown[] }
  | { kind: 'missing_table' }
  | { kind: 'error' };

/** List the business's exempt numbers (newest first). */
export async function listExemptNumbers(
  supabase: SupabaseServer,
  businessId: string,
): Promise<ListResult> {
  const { data, error } = await supabase
    .from('business_exempt_numbers')
    .select('phone, label')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { kind: 'missing_table' };
    return { kind: 'error' };
  }
  return { kind: 'ok', numbers: data ?? [] };
}

export type UpsertResult =
  | { kind: 'ok' }
  | { kind: 'missing_table' }
  | { kind: 'error' };

/** Upsert a batch of exempt numbers (idempotent on business_id,phone). */
export async function upsertExemptNumbers(
  supabase: SupabaseServer,
  rows: ExemptRow[],
): Promise<UpsertResult> {
  const { error } = await supabase
    .from('business_exempt_numbers')
    .upsert(rows, { onConflict: 'business_id,phone', ignoreDuplicates: true });
  if (error) {
    if (isMissingTable(error)) return { kind: 'missing_table' };
    return { kind: 'error' };
  }
  return { kind: 'ok' };
}

export type DeleteResult =
  | { kind: 'ok' }
  | { kind: 'missing_table' }
  | { kind: 'error' };

/** Remove one exempt number from the business's list. */
export async function deleteExemptNumber(
  supabase: SupabaseServer,
  businessId: string,
  phone: string,
): Promise<DeleteResult> {
  const { error } = await supabase
    .from('business_exempt_numbers')
    .delete()
    .eq('business_id', businessId)
    .eq('phone', phone);
  if (error) {
    if (isMissingTable(error)) return { kind: 'missing_table' };
    return { kind: 'error' };
  }
  return { kind: 'ok' };
}
