// Phone-number requests — repository. The businesses table has no business_id
// column (its PK *is* the business id), so these use the service-role client with
// explicit id/business_id filters rather than the tenantDb wrapper.

import { AppError } from '../../core/errors';
import type { TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

export interface BusinessNumberInfo {
  id: string;
  city: string | null;
  business_phone_number: string | null;
}

export interface PendingRequestRow {
  status: string;
  requested_city: string | null;
  created_at: string;
}

export async function getBusinessNumberInfo(ctx: RepoContext): Promise<BusinessNumberInfo | null> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('id, city, business_phone_number')
    .eq('id', ctx.businessId)
    .maybeSingle();
  if (error) throw new AppError('business_query_failed', 500);
  return (data as BusinessNumberInfo) ?? null;
}

export async function getSubscriptionStatus(ctx: RepoContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('business_subscriptions')
    .select('status')
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return data ? (data as { status: string }).status : null;
}

export async function getPendingRequest(ctx: RepoContext, ordered: boolean): Promise<PendingRequestRow | null> {
  let q = ctx.supabase
    .from('phone_number_requests')
    .select('status, requested_city, created_at')
    .eq('business_id', ctx.businessId)
    .eq('status', 'pending');
  if (ordered) q = q.order('created_at', { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  return (data as PendingRequestRow) ?? null;
}

/** Returns the supabase error (code/message) on failure, or null on success. */
export async function insertPendingRequest(
  ctx: RepoContext,
  requestedCity: string | null,
): Promise<{ code?: string; message?: string } | null> {
  const { error } = await ctx.supabase.from('phone_number_requests').insert({
    business_id: ctx.businessId,
    requested_city: requestedCity,
    source: 'number_page',
    status: 'pending',
  });
  return error ? { code: (error as { code?: string }).code, message: (error as { message?: string }).message } : null;
}
