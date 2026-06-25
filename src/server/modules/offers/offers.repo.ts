// Offers — repository (tenant-safe data access + offer-number generation). Reference module.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { buildOfferCode } from '../../../lib/offer-code';
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
