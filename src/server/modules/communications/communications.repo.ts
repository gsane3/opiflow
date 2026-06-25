// Communications — repository (tenant-safe data access).

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  COMMUNICATION_COLUMNS,
  COMMUNICATION_CUSTOMER_COLUMNS,
  type CommunicationCustomerRow,
  type CommunicationRow,
} from './communications.types';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface ListCommunicationsParams {
  channel?: string;
  direction?: string;
  customerId?: string;
  limit: number;
  offset: number;
}

export async function listCommunicationRows(
  ctx: RepoContext,
  params: ListCommunicationsParams,
): Promise<CommunicationRow[]> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  let qb = db
    .from('communications')
    .select(COMMUNICATION_COLUMNS)
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);
  if (params.channel) qb = qb.eq('channel', params.channel);
  if (params.direction) qb = qb.eq('direction', params.direction);
  if (params.customerId) qb = qb.eq('customer_id', params.customerId);

  const { data, error } = await qb;
  if (error) throw new AppError('communications_query_failed', 500);
  return ((data ?? []) as unknown[]).map((r) => r as CommunicationRow);
}

export async function fetchCustomersByIds(
  ctx: RepoContext,
  ids: string[],
): Promise<Map<string, CommunicationCustomerRow>> {
  const map = new Map<string, CommunicationCustomerRow>();
  if (ids.length === 0) return map;
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('customers')
    .select(COMMUNICATION_CUSTOMER_COLUMNS)
    .in('id', ids);
  if (error) throw new AppError('customer_lookup_failed', 500);
  for (const row of (data ?? []) as unknown[]) {
    const r = row as CommunicationCustomerRow;
    map.set(r.id, r);
  }
  return map;
}

export async function customerExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}

export async function insertCommunicationRow(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<CommunicationRow> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('communications')
    .insert(values)
    .select(COMMUNICATION_COLUMNS)
    .single();
  if (error || !data) throw new AppError('communications_create_failed', 500);
  return data as unknown as CommunicationRow;
}

export async function communicationExists(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('communications').byId(id, 'id').maybeSingle();
  if (error) throw new AppError('communication_delete_failed', 500);
  return data !== null && data !== undefined;
}

export async function deleteCommunicationRow(ctx: RepoContext, id: string): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { error } = await db.from('communications').delete().eq('id', id);
  if (error) throw new AppError('communication_delete_failed', 500);
}

/** Updates customer_id; returns the row or null if no row matched this tenant. */
export async function updateCommunicationCustomer(
  ctx: RepoContext,
  id: string,
  customerId: string | null,
): Promise<CommunicationRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db
    .from('communications')
    .update({ customer_id: customerId })
    .eq('id', id)
    .select(COMMUNICATION_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError('communication_update_failed', 500);
  return (data as unknown as CommunicationRow) ?? null;
}
