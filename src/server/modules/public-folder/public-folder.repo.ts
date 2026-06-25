// Public-folder — repository (service-role data access, explicit tenant scope).
// Parity-matched to the five public /f/[token] portal routes.
//
// There is NO business user here, so these methods use the SERVICE-ROLE client
// the route built (createServiceSupabaseClient) and apply the token-derived
// business_id + work_folder_id as EXPLICIT `.eq` filters (never tenantDb). Each
// method returns the raw `{ data, error }` (or the .select() rows) exactly like
// the live route inspected, so the SERVICE keeps every route code decision
// (folder_not_found / offer_not_found / payment_not_actionable / *_failed) verbatim.

import type { PublicFolderContext } from './public-folder.types';

type Maybe = { data: unknown; error: unknown };

/** message POST step: resolve the folder (customer_id + title), business + folder scoped. */
export async function fetchFolderForMessage(ctx: PublicFolderContext): Promise<Maybe> {
  const res = await ctx.supabase
    .from('work_folders')
    .select('customer_id, title')
    .eq('id', ctx.workFolderId)
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return { data: res.data, error: res.error };
}

/** message POST step: log the inbound question on the customer timeline. */
export async function insertQuestionCommunication(
  ctx: PublicFolderContext,
  values: Record<string, unknown>,
): Promise<{ error: unknown }> {
  const res = await ctx.supabase.from('communications').insert(values);
  return { error: res.error };
}

/** message GET step: the customer↔business Q&A thread (call excluded), oldest-first. */
export async function listFolderMessages(ctx: PublicFolderContext): Promise<Maybe> {
  const res = await ctx.supabase
    .from('communications')
    .select('direction, channel, summary, created_at')
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', ctx.workFolderId)
    .in('channel', ['sms', 'viber', 'email'])
    .in('status', ['completed', 'sent', 'delivered', 'seen'])
    .order('created_at', { ascending: true })
    .limit(50);
  return { data: res.data, error: res.error };
}

/** message GET step (best-effort): mark the owner's outbound messages read + roll last_visited_at. */
export async function markFolderRead(ctx: PublicFolderContext, ts: string): Promise<void> {
  await ctx.supabase
    .from('communications')
    .update({ read_at: ts })
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', ctx.workFolderId)
    .eq('direction', 'outbound')
    .is('read_at', null);
  await ctx.supabase
    .from('customer_folder_tokens')
    .update({ last_visited_at: ts })
    .eq('id', ctx.tokenId);
}

/** offer/accept step: fetch the offer TRIPLE-scoped (business + folder). */
export async function fetchOfferForResponse(
  ctx: PublicFolderContext,
  offerId: string,
  columns: string,
): Promise<Maybe> {
  const res = await ctx.supabase
    .from('offers')
    .select(columns)
    .eq('id', offerId)
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', ctx.workFolderId)
    .maybeSingle();
  return { data: res.data, error: res.error };
}

/** appointment/respond step: fetch the task TRIPLE-scoped (business + folder). */
export async function fetchTaskForResponse(
  ctx: PublicFolderContext,
  taskId: string,
  columns: string,
): Promise<Maybe> {
  const res = await ctx.supabase
    .from('tasks')
    .select(columns)
    .eq('id', taskId)
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', ctx.workFolderId)
    .maybeSingle();
  return { data: res.data, error: res.error };
}

/** payment POST step: atomic 'pending' → 'declared', business + folder scoped. */
export async function declarePayment(
  ctx: PublicFolderContext,
  paymentRequestId: string,
  now: string,
): Promise<Maybe> {
  const res = await ctx.supabase
    .from('payment_requests')
    .update({ status: 'declared', declared_at: now, updated_at: now })
    .eq('id', paymentRequestId)
    .eq('business_id', ctx.businessId)
    .eq('work_folder_id', ctx.workFolderId)
    .eq('status', 'pending')
    .select('id, customer_id');
  return { data: res.data, error: res.error };
}

/** upload-link step: resolve the folder's customer_id, business + folder scoped. */
export async function fetchFolderForUpload(ctx: PublicFolderContext): Promise<Maybe> {
  const res = await ctx.supabase
    .from('work_folders')
    .select('customer_id')
    .eq('id', ctx.workFolderId)
    .eq('business_id', ctx.businessId)
    .maybeSingle();
  return { data: res.data, error: res.error };
}
