// Customer-message — repository (tenant-scoped data access). Parity-matched to
// POST /api/customers/[id]/message.
//
// This route resolves its tenant from the AUTHENTICATED business user (Bearer →
// authenticateBusinessRequest), then performs two business-scoped reads:
//   1. load the target customer (phone columns + preferred_contact_method),
//      scoped to business_id + the path :id,
//   2. when filing into a project, verify the work_folder belongs to this
//      business AND this customer before tagging the message.
//
// Both reads keep the live route's EXACT `.eq('business_id', …)` / id filters and
// column lists, so the multi-tenant scoping is byte-for-byte unchanged. DB results
// mirror the route (it reads only `data`, ignoring `error`).

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = {
  userId: string;
  businessId: string;
  role: string;
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

type SupabaseClient = RepoContext['supabase'];

// ---------------------------------------------------------------------------
// customers (load the target customer for phone + preferred channel)
// ---------------------------------------------------------------------------

export interface CustomerContactRow {
  phone: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  preferred_contact_method: string | null;
}

/**
 * Load the customer (scoped to this business) for phone + preferred channel.
 * Returns null when no row matches (the route then 404s `customer_not_found`).
 */
export async function loadCustomerContact(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<CustomerContactRow | null> {
  const { data: customer } = await supabase
    .from('customers')
    .select('id, phone, mobile_phone, landline_phone, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (!customer) return null;
  return customer as CustomerContactRow;
}

// ---------------------------------------------------------------------------
// work_folders (verify the project belongs to this business + customer)
// ---------------------------------------------------------------------------

/**
 * True when `workFolderId` is a work_folder of this business AND this customer.
 * Mirrors the route's best-effort tag check (reads only `data`).
 */
export async function workFolderBelongs(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
  workFolderId: string,
): Promise<boolean> {
  const { data: f } = await supabase
    .from('work_folders')
    .select('id')
    .eq('id', workFolderId)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle();
  return !!f;
}
