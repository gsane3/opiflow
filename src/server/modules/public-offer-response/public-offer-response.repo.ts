// Public offer-response — repository (data access for the PUBLIC token route).
//
// These queries run on the service-role Supabase client (bypasses RLS), so every
// query is EXPLICITLY scoped by business_id from the verified token row — there is
// no TenantContext/requireBusinessUser here. The repo returns raw Supabase
// { data, error } results so the service preserves the route's exact error mapping
// (offer_response_load_failed on any DB error, byte-for-byte).

import type { createServiceSupabaseClient } from '../../../lib/server/offer-response-tokens';

export type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

export interface RepoContext {
  supabase: ServiceSupabaseClient;
  businessId: string;
}

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

export const OFFER_COLUMNS = [
  'id', 'business_id', 'customer_id', 'offer_number', 'status',
  'offer_date', 'valid_until',
  'subtotal', 'vat_rate', 'vat_amount', 'total',
  'notes', 'terms', 'acceptance_text',
  'updated_at',
].join(', ');

export const ITEM_COLUMNS = [
  'description', 'quantity', 'unit_price', 'line_total', 'sort_order',
].join(', ');

export const BUSINESS_COLUMNS = [
  'name', 'phone', 'email', 'address', 'vat_number', 'logo_url',
  'legal_name', 'trade_name', 'address_line1', 'address_line2',
  'postal_code', 'city', 'region', 'tax_office', 'website',
].join(', ');

export const CUSTOMER_COLUMNS = [
  'name', 'company_name', 'email', 'address',
].join(', ');

// ---------------------------------------------------------------------------
// Row interfaces
// ---------------------------------------------------------------------------

export interface OfferRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  offer_number: string;
  status: string;
  offer_date: string;
  valid_until: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptance_text: string | null;
  updated_at: string;
}

export interface OfferItemRow {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
}

export interface BusinessRow {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
  logo_url: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  tax_office: string | null;
  website: string | null;
}

export interface CustomerRow {
  name: string;
  company_name: string | null;
  email: string | null;
  address: string | null;
}

// ---------------------------------------------------------------------------
// Fetches — each returns the raw Supabase result so the service maps errors itself.
// All are scoped by the explicit business_id from the verified token row.
// ---------------------------------------------------------------------------

export async function fetchOffer(
  ctx: RepoContext,
  offerId: string,
): Promise<{ data: OfferRow | null; error: unknown }> {
  const { data, error } = await ctx.supabase
    .from('offers')
    .select(OFFER_COLUMNS)
    .eq('id', offerId)
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return { data: (data as unknown as OfferRow) ?? null, error };
}

export async function fetchOfferItems(
  ctx: RepoContext,
  offerId: string,
): Promise<{ data: OfferItemRow[] | null; error: unknown }> {
  const { data, error } = await ctx.supabase
    .from('offer_items')
    .select(ITEM_COLUMNS)
    .eq('business_id', ctx.businessId)
    .eq('offer_id', offerId)
    .order('sort_order', { ascending: true });
  return { data: (data as unknown as OfferItemRow[]) ?? null, error };
}

export async function fetchBusiness(
  ctx: RepoContext,
): Promise<{ data: BusinessRow | null; error: unknown }> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select(BUSINESS_COLUMNS)
    .eq('id', ctx.businessId)
    .maybeSingle();
  return { data: (data as unknown as BusinessRow) ?? null, error };
}

export async function fetchCustomer(
  ctx: RepoContext,
  customerId: string,
): Promise<{ data: CustomerRow | null; error: unknown }> {
  const { data, error } = await ctx.supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', customerId)
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return { data: (data as unknown as CustomerRow) ?? null, error };
}
