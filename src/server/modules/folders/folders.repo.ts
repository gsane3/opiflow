// Έργο (work folder) detail / attach / attachable — repository (tenant-safe data
// access). Parity-matched to /api/folders/[id], /attach, /attachable.
//
// Every query is scoped to the tenant. Standard select/byId/update/delete go
// through `tenantDb` (business_id auto-injected); the head-count payment guard
// uses the native client with an explicit business_id filter because PostgREST
// count options aren't exposed by the tenantDb wrapper.
//
// The migration-047 double-select (FOLDER_COLUMNS with `step`, retry WITHOUT it on
// error) and the migration-tolerant read-receipt merge are reproduced verbatim so
// the wire format is byte-identical to the live routes.

import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import type { WorkFolderRow } from '../../../lib/server/work-folders';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

// `step` requires migration 047. We try WITH it and fall back WITHOUT it so the
// folder still loads/updates when 047 hasn't been applied (graceful degradation).
export const FOLDER_COLUMNS =
  'id, business_id, customer_id, title, status, step, notes, created_at, updated_at';
export const FOLDER_COLUMNS_BASE =
  'id, business_id, customer_id, title, status, notes, created_at, updated_at';

type Maybe = { data: unknown; error: unknown };

/**
 * Fetch one folder by id (business-scoped) with the migration-047 double-select
 * fallback. Returns `{ data, error }` exactly like the live route inspected, so the
 * caller drives the folder_detail_failed / folder_not_found decisions unchanged.
 */
export async function fetchFolderWithFallback(
  ctx: RepoContext,
  folderId: string,
): Promise<Maybe> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const primary = await db.from('work_folders').byId(folderId, FOLDER_COLUMNS).maybeSingle();
  let data: unknown = primary.data;
  let error = primary.error;
  if (error) {
    const fb = await db.from('work_folders').byId(folderId, FOLDER_COLUMNS_BASE).maybeSingle();
    data = fb.data;
    error = fb.error;
  }
  return { data, error };
}

export interface FolderDetailSources {
  custRes: { data: unknown };
  offersRes: { data: unknown; count: number | null };
  apptRes: { data: unknown; count: number | null };
  msgRes: { data: unknown; count: number | null };
  photoRes: { data: unknown; count: number | null };
  intakeRes: { data: unknown; count: number | null };
}

/**
 * The six parallel folder-detail section reads (customer + 5 attached sections).
 *
 * tenantDb's `.select()` doesn't expose PostgREST's count option, so these use the
 * native service-role client with an EXPLICIT `business_id` filter — byte-identical
 * to the live route, with the per-section `{ count: 'exact' }` preserved.
 */
export async function fetchFolderDetailSources(
  ctx: RepoContext,
  folderId: string,
  customerId: string,
  appointmentTaskTypes: readonly string[],
): Promise<FolderDetailSources> {
  const businessId = ctx.businessId;
  const [custRes, offersRes, apptRes, msgRes, photoRes, intakeRes] = await Promise.all([
    ctx.supabase
      .from('customers')
      .select('id, name, company_name, crm_number, phone, mobile_phone, email, address, vat_number, intake_status')
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle(),
    ctx.supabase
      .from('offers')
      .select('id, offer_number, status, total, created_at', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .order('created_at', { ascending: false })
      .limit(3),
    ctx.supabase
      .from('tasks')
      .select('id, title, type, status, due_date, due_time, created_at', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .in('type', appointmentTaskTypes as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(3),
    ctx.supabase
      .from('communications')
      .select('id, summary, direction, channel, created_at', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .order('created_at', { ascending: false })
      .limit(3),
    ctx.supabase
      .from('customer_upload_tokens')
      .select('id, status, sent_channel, created_at, opened_at, completed_at', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .order('created_at', { ascending: false })
      .limit(4),
    ctx.supabase
      .from('customer_intake_tokens')
      .select('id, status, sent_channel, created_at, opened_at, submitted_at', { count: 'exact' })
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .order('created_at', { ascending: false })
      .limit(4),
  ]);
  return {
    custRes: custRes as { data: unknown },
    offersRes: offersRes as { data: unknown; count: number | null },
    apptRes: apptRes as { data: unknown; count: number | null },
    msgRes: msgRes as { data: unknown; count: number | null },
    photoRes: photoRes as { data: unknown; count: number | null },
    intakeRes: intakeRes as { data: unknown; count: number | null },
  };
}

/** Read receipts (migration 057): tolerant — caller swallows any failure. */
export async function fetchReadReceipts(
  ctx: RepoContext,
  msgIds: string[],
): Promise<{ data: unknown; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  return db.from('communications').select('id, read_at').in('id', msgIds);
}

/** No-field-change PATCH path: fetch the current folder with the 047 fallback. */
export async function fetchFolderForNoUpdate(
  ctx: RepoContext,
  folderId: string,
): Promise<Maybe> {
  return fetchFolderWithFallback(ctx, folderId);
}

/** Previous status read (terminal-transition detection). */
export async function fetchFolderStatus(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: { status?: string } | null }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from('work_folders').byId(folderId, 'status').maybeSingle();
  return { data: res.data as { status?: string } | null };
}

/**
 * Apply the folder update with the migration-047 fallback (drop `step` + select
 * base on error). Returns `{ data, error }` for the caller to map.
 */
export async function updateFolderWithFallback(
  ctx: RepoContext,
  folderId: string,
  updateFields: Record<string, unknown>,
): Promise<Maybe> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const primary = await db
    .from('work_folders')
    .update(updateFields)
    .eq('id', folderId)
    .select(FOLDER_COLUMNS)
    .maybeSingle();
  let data: unknown = primary.data;
  let error = primary.error;
  if (error) {
    const fieldsNoStep: Record<string, unknown> = { ...updateFields };
    delete fieldsNoStep.step;
    const fb = await db
      .from('work_folders')
      .update(fieldsNoStep)
      .eq('id', folderId)
      .select(FOLDER_COLUMNS_BASE)
      .maybeSingle();
    data = fb.data;
    error = fb.error;
  }
  return { data, error };
}

/** Existence check (DELETE). `{ data, error }` so the caller maps the codes. */
export async function fetchFolderId(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: unknown; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  return db.from('work_folders').byId(folderId, 'id').maybeSingle();
}

/** Count declared/confirmed payment_requests on this folder (delete guard). */
export async function countLandedPayments(
  ctx: RepoContext,
  folderId: string,
): Promise<number | null> {
  const { count } = await ctx.supabase
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', folderId)
    .in('status', ['declared', 'confirmed']);
  return count ?? null;
}

/** Delete the folder (business-scoped). `{ error }` for the caller to map. */
export async function deleteFolder(
  ctx: RepoContext,
  folderId: string,
): Promise<{ error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('work_folders').delete().eq('id', folderId);
  return { error };
}

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------

/** Folder existence + customer_id (attach step 1). */
export async function fetchFolderForAttach(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: { customer_id: string } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from('work_folders').byId(folderId, 'id, customer_id').maybeSingle();
  return { data: res.data as { customer_id: string } | null, error: res.error };
}

/** Entity existence + customer_id (attach step 2). */
export async function fetchEntityForAttach(
  ctx: RepoContext,
  table: string,
  entityId: string,
): Promise<{ data: { customer_id: string | null } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from(table).byId(entityId, 'id, customer_id').maybeSingle();
  return { data: res.data as { customer_id: string | null } | null, error: res.error };
}

/**
 * Apply the work_folder_id (un)set, re-asserting the tenant filter and — on attach —
 * pinning customer_id so a race can't file a wrong-customer row (attach step 4).
 */
export async function applyAttach(
  ctx: RepoContext,
  table: string,
  entityId: string,
  workFolderId: string | null,
  attach: boolean,
  folderCustomerId: string,
): Promise<{ error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let update = db.from(table).update({ work_folder_id: workFolderId }).eq('id', entityId);
  if (attach) update = update.eq('customer_id', folderCustomerId);
  const { error } = await update;
  return { error };
}

// ---------------------------------------------------------------------------
// attachable
// ---------------------------------------------------------------------------

/** Folder customer_id lookup (attachable). */
export async function fetchFolderCustomer(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: { customer_id: string } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from('work_folders').byId(folderId, 'customer_id').maybeSingle();
  return { data: res.data as { customer_id: string } | null, error: res.error };
}

export interface AttachableSources {
  offersRes: { data: unknown; error: unknown };
  apptRes: { data: unknown; error: unknown };
  msgRes: { data: unknown; error: unknown };
  intakeRes: { data: unknown; error: unknown };
  uploadRes: { data: unknown; error: unknown };
}

/** The five parallel unfiled-pick reads for the attachable list. */
export async function fetchAttachableSources(
  ctx: RepoContext,
  customerId: string,
  appointmentTaskTypes: readonly string[],
  pickLimit: number,
  reqLimit: number,
): Promise<AttachableSources> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const [offersRes, apptRes, msgRes, intakeRes, uploadRes] = await Promise.all([
    db
      .from('offers')
      .select('id, offer_number, status, total, created_at')
      .eq('customer_id', customerId)
      .is('work_folder_id', null)
      .order('created_at', { ascending: false })
      .limit(pickLimit),
    db
      .from('tasks')
      .select('id, title, type, status, due_date, due_time')
      .eq('customer_id', customerId)
      .is('work_folder_id', null)
      .in('type', appointmentTaskTypes as unknown as string[])
      .order('due_date', { ascending: false })
      .limit(pickLimit),
    db
      .from('communications')
      .select('id, direction, channel, summary, created_at')
      .eq('customer_id', customerId)
      .is('work_folder_id', null)
      .order('created_at', { ascending: false })
      .limit(reqLimit),
    db
      .from('customer_intake_tokens')
      .select('id, status, sent_channel, created_at')
      .eq('customer_id', customerId)
      .is('work_folder_id', null)
      .order('created_at', { ascending: false })
      .limit(reqLimit),
    db
      .from('customer_upload_tokens')
      .select('id, status, sent_channel, created_at')
      .eq('customer_id', customerId)
      .is('work_folder_id', null)
      .order('created_at', { ascending: false })
      .limit(reqLimit),
  ]);
  return {
    offersRes: offersRes as { data: unknown; error: unknown },
    apptRes: apptRes as { data: unknown; error: unknown },
    msgRes: msgRes as { data: unknown; error: unknown },
    intakeRes: intakeRes as { data: unknown; error: unknown },
    uploadRes: uploadRes as { data: unknown; error: unknown },
  };
}

export type { WorkFolderRow };
