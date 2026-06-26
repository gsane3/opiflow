// Businesses — repository (tenant data access for the business profile + bank).
//
// The `businesses` table is keyed by `id` (its PK IS the business id — there is NO
// business_id column), so these helpers scope with ctx.supabase.from('businesses')
// .eq('id', businessId) directly, NOT tenantDb. Per-operation AppError codes mirror
// the live /api/businesses/me + /api/businesses/me/bank routes exactly.

import { AppError } from '../../core/errors';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

export const BUSINESS_COLUMNS =
  'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, legal_name, trade_name, owner_first_name, owner_last_name, address_line1, address_line2, postal_code, region, website, facebook_url, instagram_url, created_at, updated_at';

export interface SubscriptionRow {
  plan_key: string;
  status: string;
  trial_ends_at: string | null;
}

export interface NumberRequestRow {
  status: string;
  requested_city: string | null;
  created_at: string;
}

/** Fetch the business profile by id. DB error → business_query_failed (500); null when missing. */
export async function getBusinessById(
  supabase: SupabaseServer,
  businessId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select(BUSINESS_COLUMNS)
    .eq('id', businessId)
    .maybeSingle();
  if (error) throw new AppError('business_query_failed', 500);
  return (data as Record<string, unknown> | null) ?? null;
}

/** Latest subscription row for the business. DB error → subscription_query_failed (500). */
export async function getSubscription(
  supabase: SupabaseServer,
  businessId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from('business_subscriptions')
    .select('plan_key, status, trial_ends_at')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) {
    console.error('[api/businesses/me] subscription query failed', {
      code:        error.code,
      message:     error.message,
      bizIdPrefix: businessId.slice(0, 8),
    });
    throw new AppError('subscription_query_failed', 500);
  }
  return (data as SubscriptionRow | null) ?? null;
}

/** Latest pending phone-number request. DB error → number_request_query_failed (500). */
export async function getPendingNumberRequest(
  supabase: SupabaseServer,
  businessId: string,
): Promise<NumberRequestRow | null> {
  const { data, error } = await supabase
    .from('phone_number_requests')
    .select('status, requested_city, created_at')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[api/businesses/me] number request query failed', {
      code:        error.code,
      message:     error.message,
      bizIdPrefix: businessId.slice(0, 8),
    });
    throw new AppError('number_request_query_failed', 500);
  }
  return (data as NumberRequestRow | null) ?? null;
}

/** Find the business owned by this user (PATCH ownership check). null when none. */
export async function findOwnedBusinessId(
  supabase: SupabaseServer,
  userId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Apply the profile update scoped to owner_id. DB error/no row → business_update_failed (500). */
export async function updateOwnedBusiness(
  supabase: SupabaseServer,
  userId: string,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('businesses')
    .update(updates)
    .eq('owner_id', userId)
    .select(BUSINESS_COLUMNS)
    .single();
  if (error || !data) {
    console.error('[api/businesses/me PATCH] update failed', {
      code:         error?.code,
      message:      error?.message,
      userIdPrefix: userId.slice(0, 8),
    });
    throw new AppError('business_update_failed', 500);
  }
  return data as Record<string, unknown>;
}

export interface BankRow {
  bank_beneficiary: string | null;
  bank_name: string | null;
  bank_iban: string | null;
}

/**
 * Read the mirrored bank columns off businesses. TOLERANT: pre-migration-048 the
 * columns don't exist → returns null (so the caller emits an empty bank, never 500).
 */
export async function getBankMirror(
  supabase: SupabaseServer,
  businessId: string,
): Promise<BankRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('bank_beneficiary, bank_name, bank_iban')
    .eq('id', businessId)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as BankRow | null) ?? null;
}
