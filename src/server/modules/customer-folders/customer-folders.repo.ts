// Customer Έργα (work folders) list/create — repository (tenant-safe data access).
// Parity-matched to /api/customers/[id]/folders (GET list + POST create).
//
// The live route does NOT use the tenantDb wrapper: it builds every query with an
// EXPLICIT `.eq('business_id', businessId)` (and `.eq('customer_id', …)`) on the
// service-role client. That is reproduced verbatim here so the constructed queries —
// and therefore the wire format — stay byte-identical. The migration-047 double-select
// (FOLDER_COLUMNS with `step`, retry WITHOUT it on error) and the best-effort per-folder
// count tally are preserved exactly.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  emptyFolderCounts,
  type FolderCounts,
} from '../../../lib/server/work-folders';

export type RepoContext = {
  userId: string;
  businessId: string;
  role: string;
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

// `step` requires migration 047. We try WITH it and fall back WITHOUT it so the
// list keeps working even when 047 hasn't been applied yet (dbToFolder defaults a
// missing step to 0). This is the real graceful-degradation path.
export const FOLDER_COLUMNS = 'id, business_id, customer_id, title, status, step, notes, created_at, updated_at';
export const FOLDER_COLUMNS_BASE = 'id, business_id, customer_id, title, status, notes, created_at, updated_at';

type Maybe = { data: unknown[] | null; error: unknown };
type Single = { data: unknown; error: unknown };

/** Confirm the customer exists AND belongs to the authenticated business. */
export async function customerBelongsToBusiness(
  ctx: RepoContext,
  customerId: string,
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * List a customer's work folders with the migration-047 double-select fallback.
 * Returns `{ data, error }` exactly like the live route inspected, so the caller
 * drives the folders_query_failed decision unchanged.
 */
export async function listFolderRowsWithFallback(
  ctx: RepoContext,
  customerId: string,
): Promise<Maybe> {
  const primary = await ctx.supabase
    .from('work_folders')
    .select(FOLDER_COLUMNS)
    .eq('business_id', ctx.businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  let rowData: unknown[] | null = primary.data as unknown[] | null;
  let queryError = primary.error;

  // Pre-migration-047 fallback: retry without `step` so the list still loads.
  if (queryError) {
    const fallback = await ctx.supabase
      .from('work_folders')
      .select(FOLDER_COLUMNS_BASE)
      .eq('business_id', ctx.businessId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    rowData = fallback.data as unknown[] | null;
    queryError = fallback.error;
  }

  return { data: rowData, error: queryError };
}

export interface FolderCountSources {
  offersRes: { data: unknown[] | null };
  tasksRes: { data: unknown[] | null };
  commsRes: { data: unknown[] | null };
  uploadRes: { data: unknown[] | null };
  intakeRes: { data: unknown[] | null };
}

/**
 * Lightweight per-folder counts. One small query per entity table (selecting only
 * work_folder_id, plus `type` on tasks), scoped to the tenant and the folder ids,
 * tallied in JS by the caller. The five parallel reads mirror the live route exactly;
 * a thrown failure is caught by the caller (best-effort → zeros).
 */
export async function fetchFolderCountSources(
  ctx: RepoContext,
  folderIds: string[],
): Promise<FolderCountSources> {
  const businessId = ctx.businessId;
  const [offersRes, tasksRes, commsRes, uploadRes, intakeRes] = await Promise.all([
    ctx.supabase.from('offers').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
    ctx.supabase.from('tasks').select('work_folder_id, type').eq('business_id', businessId).in('work_folder_id', folderIds),
    ctx.supabase.from('communications').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
    ctx.supabase.from('customer_upload_tokens').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
    ctx.supabase.from('customer_intake_tokens').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
  ]);
  return {
    offersRes: offersRes as { data: unknown[] | null },
    tasksRes: tasksRes as { data: unknown[] | null },
    commsRes: commsRes as { data: unknown[] | null },
    uploadRes: uploadRes as { data: unknown[] | null },
    intakeRes: intakeRes as { data: unknown[] | null },
  };
}

export { emptyFolderCounts };
export type { FolderCounts };

/**
 * Insert a new work folder (BASE columns, no `step`, so create works pre-047; a new
 * folder's step is 0). Returns `{ data, error }` for the caller to map.
 */
export async function insertFolderRow(
  ctx: RepoContext,
  customerId: string,
  values: { title: string; status: string; notes: string | null; updated_at: string },
): Promise<Single> {
  const { data, error } = await ctx.supabase
    .from('work_folders')
    .insert({
      business_id: ctx.businessId,
      customer_id: customerId,
      title: values.title,
      status: values.status,
      notes: values.notes,
      updated_at: values.updated_at,
    })
    // BASE columns (no `step`) so create works pre-047; a new folder's step is 0.
    .select(FOLDER_COLUMNS_BASE)
    .single();
  return { data, error };
}
