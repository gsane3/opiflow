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

// --- call brief (GET /api/calls/[id]/brief) ---------------------------------

export interface CallCommRow {
  id: string;
  customer_id: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  brief_created_at: string | null;
}

/**
 * Fetch the call's communications row (channel='call'), tolerant of a pre-migration DB
 * with no brief_created_at column (falls back to a column-less select). server_error (500)
 * only when BOTH selects error; null when no row matches.
 */
export async function fetchCallComm(ctx: RepoContext, id: string): Promise<CallCommRow | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const withCol = await db
    .from('communications')
    .select('id, customer_id, channel, direction, status, phone, summary, brief_created_at')
    .eq('id', id)
    .eq('channel', 'call')
    .maybeSingle();
  if (withCol.error) {
    const base = await db
      .from('communications')
      .select('id, customer_id, channel, direction, status, phone, summary')
      .eq('id', id)
      .eq('channel', 'call')
      .maybeSingle();
    if (base.error) throw new AppError('server_error', 500);
    return base.data ? ({ ...(base.data as object), brief_created_at: null } as CallCommRow) : null;
  }
  return (withCol.data as unknown as CallCommRow | null) ?? null;
}

/** All briefs for a communication, oldest first. Errors degrade to [] (parity with the route). */
export async function fetchCallBriefs(
  ctx: RepoContext,
  communicationId: string,
): Promise<Array<{ brief_kind: string; brief_text: string; created_at: string }>> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db
    .from('call_briefs')
    .select('brief_kind, brief_text, created_at')
    .eq('communication_id', communicationId)
    .order('created_at', { ascending: true });
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data as unknown as Array<{ brief_kind: string; brief_text: string; created_at: string }>;
}

/** Display name for the (optional) linked customer: name ?? company_name ?? null. */
export async function fetchCallCustomerName(ctx: RepoContext, customerId: string): Promise<string | null> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const { data } = await db.from('customers').byId(customerId, 'name, company_name').maybeSingle();
  const c = data as { name: string | null; company_name: string | null } | null;
  return c?.name ?? c?.company_name ?? null;
}
