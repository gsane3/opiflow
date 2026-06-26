// AI assistant — repository (tenant-scoped data access for the AI routes).
//
// Only the customer-memory and cmd routes touch the database (both scoped to the
// caller's business). Every query mirrors the live route verbatim: same table,
// same .select string, same .eq filters, same ordering/limits, and the SAME
// error handling (errors are surfaced via the boolean/`error` the caller already
// branches on — they are NOT converted into thrown AppErrors here, because the
// live routes branch on them inline).

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ---------------------------------------------------------------------------
// cmd route: service-catalog price enrichment (best-effort).
// ---------------------------------------------------------------------------

export interface CatalogPriceRow {
  name: string | null;
  unit_price: number | null;
}

/** Mirrors the cmd route's catalog query: active items for the business, up to 500. */
export async function fetchCatalogPriceRows(
  supabase: SupabaseServer,
  businessId: string,
): Promise<CatalogPriceRow[]> {
  const { data } = await supabase
    .from('service_catalog_items')
    .select('name, unit_price')
    .eq('business_id', businessId)
    .eq('active', true)
    .limit(500);
  return (data ?? []) as Array<{ name: string | null; unit_price: number | null }>;
}

// ---------------------------------------------------------------------------
// customer-memory route: business context + CRM context loads.
// ---------------------------------------------------------------------------

export interface CustomerContextRow {
  id: string;
  name: string | null;
  company_name: string | null;
  status: string;
  source: string | null;
  needs_summary: string | null;
  status_summary: string | null;
  business_notes: string | null;
  personal_notes: string | null;
  next_best_action: string | null;
}

export interface CommContextRow {
  summary: string | null;
  channel: string;
  direction: string;
  created_at: string;
}

export interface TaskContextRow {
  title: string;
  type: string;
  status: string;
  due_date: string | null;
  note: string | null;
  created_from_ai: boolean;
}

export interface OfferContextRow {
  offer_number: string;
  status: string;
  total: number;
  offer_date: string | null;
}

/** Fetch the business row by id. Used by the route's getBusinessContext after
 *  resolveBusinessContext picks the businessId. Returns the raw row or null. */
export async function fetchBusinessById(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ id: string; name: string | null; type: string | null } | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, type')
    .eq('id', businessId)
    .maybeSingle();
  if (!data) return null;
  return data as unknown as { id: string; name: string | null; type: string | null };
}

/** Load the customer scoped to the business. Returns the raw { data, error } so the
 *  service can branch on `error` (→ customer_query_failed) vs `!data` (→ customer_not_found). */
export async function fetchCustomerContext(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
): Promise<{ data: unknown; error: unknown }> {
  const { data, error } = await supabase
    .from('customers')
    .select(
      'id, name, company_name, status, source, needs_summary, status_summary, business_notes, personal_notes, next_best_action'
    )
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return { data, error };
}

export async function fetchCommsContext(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
): Promise<CommContextRow[]> {
  const { data } = await supabase
    .from('communications')
    .select('summary, channel, direction, created_at')
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(5);
  return ((data ?? []) as unknown[]) as CommContextRow[];
}

export async function fetchTasksContext(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
): Promise<TaskContextRow[]> {
  const { data } = await supabase
    .from('tasks')
    .select('title, type, status, due_date, note, created_from_ai')
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .in('status', ['open', 'ai_draft'])
    .order('due_date', { ascending: true })
    .limit(3);
  return ((data ?? []) as unknown[]) as TaskContextRow[];
}

export async function fetchOffersContext(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
): Promise<OfferContextRow[]> {
  const { data } = await supabase
    .from('offers')
    .select('offer_number, status, total, offer_date')
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(3);
  return ((data ?? []) as unknown[]) as OfferContextRow[];
}
