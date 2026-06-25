// Folder-actions — repository (tenant-safe data access). Parity-matched to
// POST /api/folders/[id]/payment-request and GET /api/folders/[id]/payment-requests.
//
// tenantDb auto-injects `.eq('business_id', businessId)` for the tenant tables
// (work_folders, offers, payment_requests). The `businesses` lookup is PK-keyed,
// so it stays on the native client with an explicit `.eq('id', businessId)`.
//
// Every method returns `{ data, error }` (or the count) exactly like the live
// route inspected, so the SERVICE keeps the route's create/list code decisions
// (folder_not_found / offer_not_found / bank_not_configured / *_failed) verbatim.

import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  PAYMENT_REQUEST_COLUMNS,
  type PaymentRequestRow,
} from '../../../lib/server/payments';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

type Maybe = { data: unknown; error: unknown };

/** Folder existence + customer_id (payment-request step 1). Business-scoped. */
export async function fetchFolderForPayment(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: { id: string; customer_id: string | null } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from('work_folders').byId(folderId, 'id, customer_id').maybeSingle();
  return { data: res.data as { id: string; customer_id: string | null } | null, error: res.error };
}

/** Offer must live in THIS folder + business (the gross source). Business-scoped + work_folder_id. */
export async function fetchOfferForPayment(
  ctx: RepoContext,
  folderId: string,
  offerId: string,
): Promise<{ data: { id: string; total: number | null } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db
    .from('offers')
    .select('id, total')
    .eq('id', offerId)
    .eq('work_folder_id', folderId)
    .maybeSingle();
  return { data: res.data as { id: string; total: number | null } | null, error: res.error };
}

/**
 * Snapshot the business bank details (requires migration 048). PK-keyed table →
 * native client with an explicit `.eq('id', businessId)`.
 */
export async function fetchBusinessBank(
  ctx: RepoContext,
  businessId: string,
): Promise<{ data: { bank_iban: string | null; bank_beneficiary: string | null } | null; error: unknown }> {
  const res = await ctx.supabase
    .from('businesses')
    .select('bank_iban, bank_beneficiary')
    .eq('id', businessId)
    .maybeSingle();
  return {
    data: res.data as { bank_iban: string | null; bank_beneficiary: string | null } | null,
    error: res.error,
  };
}

/**
 * Insert the payment request (business_id auto-injected by tenantDb). Returns
 * `{ data, error }` so the service maps payment_request_failed on insErr/no-row.
 */
export async function insertPaymentRequest(
  ctx: RepoContext,
  values: Record<string, unknown>,
): Promise<Maybe> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db
    .from('payment_requests')
    .insert(values)
    .select(PAYMENT_REQUEST_COLUMNS)
    .single();
  return { data: res.data, error: res.error };
}

/** Folder existence check (payment-requests list step 1). Business-scoped. */
export async function fetchFolderId(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db.from('work_folders').byId(folderId, 'id').maybeSingle();
  return { data: res.data as { id: string } | null, error: res.error };
}

/**
 * List a folder's payment requests, newest first. Business-scoped + work_folder_id.
 * Returns `{ data, error }`; the service degrades a query error to an empty list
 * (pre-048 tolerance) exactly like the live route.
 */
export async function listPaymentRequests(
  ctx: RepoContext,
  folderId: string,
): Promise<{ data: PaymentRequestRow[] | null; error: unknown }> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  const res = await db
    .from('payment_requests')
    .select(PAYMENT_REQUEST_COLUMNS)
    .eq('work_folder_id', folderId)
    .order('created_at', { ascending: false });
  return { data: res.data as unknown as PaymentRequestRow[] | null, error: res.error };
}
