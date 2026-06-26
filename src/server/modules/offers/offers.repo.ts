// Offers — repository (tenant-safe data access + offer-number generation). Reference module.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { buildOfferCode } from '../../../lib/offer-code';
import { createServiceSupabaseClient } from '../../../lib/server/offer-response-tokens';
import {
  ITEM_COLUMNS,
  OFFER_COLUMNS,
  type OfferItemRow,
  type OfferRow,
} from './offers.types';
export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface ListOfferRowsParams {
  status?: string;
  customerId?: string;
  limit: number;
  offset: number;
}

export async function listOfferRows(ctx: RepoContext, query: ListOfferRowsParams): Promise<OfferRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db.from('offers').select(OFFER_COLUMNS);
  if (query.status) qb = qb.eq('status', query.status);
  if (query.customerId) qb = qb.eq('customer_id', query.customerId);
  qb = qb
    .order('offer_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  const { data, error } = await qb;
  if (error) throw new AppError('offers_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as OfferRow);
}

export async function fetchItemsForOffers(
  ctx: RepoContext,
  offerIds: string[],
): Promise<Record<string, OfferItemRow[]>> {
  if (offerIds.length === 0) return {};
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db
    .from('offer_items')
    .select(ITEM_COLUMNS)
    .in('offer_id', offerIds)
    .order('sort_order', { ascending: true });
  const map: Record<string, OfferItemRow[]> = {};
  for (const row of ((data ?? []) as unknown[]).map((r) => r as OfferItemRow)) {
    (map[row.offer_id] ??= []).push(row);
  }
  return map;
}

export async function insertOfferRow(ctx: RepoContext, values: Record<string, unknown>): Promise<OfferRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offers').insert(values).select(OFFER_COLUMNS).single();
  if (error || !data) throw new AppError('offer_create_failed', 500);
  return data as unknown as OfferRow;
}

export async function insertOfferItems(
  ctx: RepoContext,
  rows: Record<string, unknown>[],
): Promise<OfferItemRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offer_items').insert(rows).select(ITEM_COLUMNS);
  if (error || !data) throw new AppError('offer_create_failed', 500);
  return (data as unknown[]).map((r) => r as OfferItemRow);
}

/** Best-effort cleanup so a failed item insert doesn't leave an orphan offer. */
export async function deleteOfferById(ctx: RepoContext, id: string): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  await db.from('offers').delete().eq('id', id);
}

// --- single-offer reads/writes for /api/offers/[id] (GET/PATCH/DELETE) -------

/** Fetch one offer by id (GET). DB error → offer_query_failed; null when no row. */
export async function getOfferRowById(ctx: RepoContext, id: string): Promise<OfferRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offers').byId(id, OFFER_COLUMNS).maybeSingle();
  if (error) throw new AppError('offer_query_failed', 500);
  return (data as unknown as OfferRow) ?? null;
}

/** Fetch one offer by id for the PATCH ownership/vat-rate read. DB error → offer_update_failed; null when no row. */
export async function fetchOfferRowForUpdate(ctx: RepoContext, id: string): Promise<OfferRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offers').byId(id, OFFER_COLUMNS).maybeSingle();
  if (error) throw new AppError('offer_update_failed', 500);
  return (data as unknown as OfferRow) ?? null;
}

/** Items for a single offer, ordered by sort_order (tenant-scoped). */
export async function fetchItemsForOffer(ctx: RepoContext, offerId: string): Promise<OfferItemRow[]> {
  const map = await fetchItemsForOffers(ctx, [offerId]);
  return map[offerId] ?? [];
}

/** Full-replace an offer's items (delete-all + insert). DB error → offer_update_failed. */
export async function replaceOfferItems(
  ctx: RepoContext,
  offerId: string,
  rows: Record<string, unknown>[],
): Promise<OfferItemRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error: deleteError } = await db.from('offer_items').delete().eq('offer_id', offerId);
  if (deleteError) throw new AppError('offer_update_failed', 500);
  const { data, error } = await db.from('offer_items').insert(rows).select(ITEM_COLUMNS);
  if (error || !data) throw new AppError('offer_update_failed', 500);
  return (data as unknown[]).map((r) => r as OfferItemRow);
}

/** Apply a partial update to one offer. DB error → offer_update_failed; null when no row. */
export async function updateOfferRow(
  ctx: RepoContext,
  id: string,
  fields: Record<string, unknown>,
): Promise<OfferRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('offers')
    .update(fields)
    .eq('id', id)
    .select(OFFER_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError('offer_update_failed', 500);
  return (data as unknown as OfferRow) ?? null;
}

/** True if the offer exists for this tenant. DB error → offer_delete_failed (the DELETE path). */
export async function findOfferExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offers').byId(id, 'id').maybeSingle();
  if (error) throw new AppError('offer_delete_failed', 500);
  return data !== null && data !== undefined;
}

/** Remove an offer's FK dependents (response tokens) via the service client. Best-effort (caller swallows). */
export async function deleteOfferResponseTokens(businessId: string, offerId: string): Promise<void> {
  const service = createServiceSupabaseClient();
  await service.from('offer_response_tokens').delete().eq('offer_id', offerId).eq('business_id', businessId);
}

/** Detach any tasks pointing at this offer (FK SET NULL), tenant-scoped. Best-effort. */
export async function detachTasksFromOffer(ctx: RepoContext, offerId: string): Promise<void> {
  await ctx.supabase
    .from('tasks')
    .update({ offer_id: null })
    .eq('offer_id', offerId)
    .eq('business_id', ctx.businessId);
}

/** Hard-delete one offer (after dependents cleared). DB error → offer_delete_failed. */
export async function deleteOfferRowChecked(ctx: RepoContext, id: string): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('offers').delete().eq('id', id);
  if (error) throw new AppError('offer_delete_failed', 500);
}

// --- response-link (POST /api/offers/[id]/response-link) ---------------------

/** True if the offer exists for this tenant. DB error → response_link_failed (the link path). */
export async function offerExistsForLink(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('offers').byId(id, 'id').maybeSingle();
  if (error) throw new AppError('response_link_failed', 500);
  return data !== null && data !== undefined;
}

/**
 * Revoke any existing pending/sent response tokens for an offer (service client, since
 * offer_response_tokens is RLS-protected). Any failure → response_link_failed.
 */
export async function revokeOfferTokensForLink(businessId: string, offerId: string): Promise<void> {
  try {
    const service = createServiceSupabaseClient();
    const now = new Date().toISOString();
    const { error } = await service
      .from('offer_response_tokens')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('business_id', businessId)
      .eq('offer_id', offerId)
      .in('status', ['pending', 'sent'])
      .is('revoked_at', null);
    if (error) throw new AppError('response_link_failed', 500);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('response_link_failed', 500);
  }
}

export async function customerExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}

export async function taskExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('tasks').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}

// Extract the running counter N from an offer_number string, robust to both
// OFFER-{N}-{YYYY}-{CODE} and the legacy OFFER-{YYYY}-{N} by dropping year-like values.
function extractOfferSeq(offerNumber: string | null): number {
  if (!offerNumber) return 0;
  const nums = (offerNumber.match(/\d+/g) ?? []).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  if (nums.length === 0) return 0;
  const seqs = nums.filter((n) => !(n >= 2000 && n <= 2100));
  const pool = seqs.length > 0 ? seqs : nums;
  return Math.max(...pool);
}

/** Next business-global offer number: OFFER-{N}-{YYYY}[-{CODE}] (atomic RPC + pre-043 scan). */
export async function generateOfferNumber(ctx: RepoContext, code = ''): Promise<string> {
  const year = new Date().getFullYear();
  const suffix = code ? `-${code}` : '';
  const build = (n: number) => `OFFER-${n}-${year}${suffix}`;

  try {
    const { data, error } = await ctx.supabase.rpc('take_next_offer_number', {
      p_business_id: ctx.businessId,
    });
    if (!error && typeof data === 'number' && data > 0) return build(data);
  } catch {
    // pre-043 — fall back to the scan
  }

  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('offers').select('offer_number');
  let maxN = 0;
  for (const row of ((data ?? []) as unknown as { offer_number: string | null }[])) {
    const n = extractOfferSeq(row.offer_number);
    if (n > maxN) maxN = n;
  }
  return build(maxN + 1);
}

/** Builds the short offer code from the customer name/company + project title. */
export async function loadOfferCode(
  ctx: RepoContext,
  customerId: string | null,
  workFolderId: string | null,
): Promise<string> {
  try {
    const db = tenantDb(ctx.supabase, ctx.businessId);
    const [custRes, folderRes] = await Promise.all([
      customerId
        ? db.from('customers').byId(customerId, 'name, company_name').maybeSingle()
        : Promise.resolve({ data: null }),
      workFolderId
        ? db.from('work_folders').byId(workFolderId, 'title').maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = custRes.data as { name: string | null; company_name: string | null } | null;
    const folder = folderRes.data as { title: string | null } | null;
    return buildOfferCode(cust?.name ?? cust?.company_name ?? null, folder?.title ?? null);
  } catch {
    return '';
  }
}
