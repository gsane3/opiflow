// Calls (in-app call logger) — repository (tenant-safe data access).

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export async function customerBelongs(ctx: RepoContext, id: string): Promise<boolean> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(id, 'id').maybeSingle();
  return data !== null && data !== undefined;
}

/** Match a customer by any of their phone columns (phone is pre-normalized + safe). */
export async function matchCustomerByPhone(ctx: RepoContext, phone: string): Promise<string | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db
    .from('customers')
    .select('id')
    .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data as unknown as { id: string }).id : null;
}

export interface ExistingCall {
  id: string;
  customer_id: string | null;
  brief_created_at: string | null;
}

export async function findCallByProviderId(
  ctx: RepoContext,
  providerCallId: string,
): Promise<ExistingCall | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db
    .from('communications')
    .select('id, customer_id, brief_created_at')
    .eq('channel', 'call')
    .eq('provider_call_id', providerCallId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as ExistingCall) ?? null;
}

export async function finalizeCall(
  ctx: RepoContext,
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  await db.from('communications').update(updates).eq('id', id);
}

export async function insertCall(ctx: RepoContext, values: Record<string, unknown>): Promise<string> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data, error } = await db.from('communications').insert(values).select('id').single();
  if (error || !data) throw new AppError('call_log_failed', 500);
  return (data as unknown as { id: string }).id;
}
